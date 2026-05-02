#!/usr/bin/env node
/**
 * backfill-activity.mjs — one-shot historical seed for `activity_events`
 * (US4 / spec acceptance criterion 4).
 *
 * Synthesises five verbs from existing tables so day-1 of the feed isn't
 * empty:
 *
 *   1. generation.created       ← assets.created_at (per row)
 *   2. generation.submitted     ← asset_review_log (action='submitted')
 *      generation.approved      ← asset_review_log (action='approved')
 *      generation.rejected      ← asset_review_log (action='rejected')
 *   3. generation.completed     ← generations (status='completed', asset_id NOT NULL)
 *   4. member.earned_feat       ← user_badges
 *   5. member.leveled_up        ← replayed xp_transactions per user
 *
 * Idempotent: every row is written with a deterministic `backfill_key` and
 * the partial unique index `activity_events_backfill_key_unique` (migration
 * 0023) plus `ON CONFLICT (backfill_key) DO NOTHING`. Re-runs are safe.
 *
 * Permissioned: this file is one of two writers allowed to bypass the
 * append-only guard (`scripts/check-activity-append-only.mjs`); the other
 * is `src/lib/activity.ts`. Anything outside those two paths that mutates
 * `activity_events` will fail CI.
 *
 * Why .mjs (not .ts):
 *   - `tsx` isn't a project dep — `pnpm run verify-migration` (which uses
 *     it) currently fails out of the box. We mirror `migrate-runtime.mjs`
 *     instead: plain ESM + `createRequire` for `pg` + drizzle's CJS bundle.
 *   - Runs anywhere Node 20+ is available; no extra setup on a fresh clone.
 *
 * Why direct INSERT vs `emitActivity()`:
 *   - The helper assigns `created_at = now()` (column default). Backfilled
 *     rows MUST carry their historical timestamp (US4 acceptance criterion
 *     3). Adding a `createdAt` override to the helper would muddy its
 *     contract — emission is a "happens now" concern. The backfill is the
 *     ONLY caller that needs to forge timestamps, so it owns the SQL.
 *   - Direct INSERT also lets us use multi-row VALUES for chunking
 *     (NFR-005's perf target) without wrapping a loop around the helper.
 *
 * Usage:
 *   node scripts/backfill-activity.mjs                  # apply
 *   node scripts/backfill-activity.mjs --dry-run        # report counts only
 *
 * Reads `DATABASE_URL` from `.env.local` (or env). Exits 0 on success.
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

// Mirrors `LEVEL_THRESHOLDS` in `src/lib/xp.ts`. Inlined here so the .mjs
// script doesn't need to import the TS module. If this curve changes, both
// places must update — covered by the level-replay test below.
const LEVEL_THRESHOLDS = [0, 50, 150, 400, 800, 1500, 3000, 6000];
const LEVEL_TITLES = [
  "Apprentice", // 1
  "Herbalist", // 2
  "Alchemist", // 3
  "Enchanter", // 4
  "Warlock", // 5
  "Archmage", // 6
  "Mythweaver", // 7
  "Elder", // 8
];

function getLevelFromXP(xp) {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

function getLevelTitle(level) {
  return LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length) - 1];
}

const CHUNK_SIZE = 5000;

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------

async function loadEnv() {
  const text = await readFile(resolve(ROOT, ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
    }
  }
}

function parseArgs() {
  return {
    dryRun: process.argv.includes("--dry-run"),
  };
}

// ----------------------------------------------------------------------------
// Per-step backfill
//
// Each step returns { written, skipped }:
//   - `written` = rows that would be / were inserted (RETURNING id count)
//   - `skipped` = candidates the SQL filters / ON CONFLICT would suppress
//                 (we don't always count these precisely; some steps just
//                 measure source-row count and infer skipped = source - written)
//
// Live mode runs the INSERTs; dry-run runs SELECT COUNT(*) on the same
// candidate set + a probe of how many would-be-written rows already have a
// matching backfill_key.
// ----------------------------------------------------------------------------

/**
 * Step 1 — generation.created from assets.
 *
 * Visibility derived inline from brands.is_personal (`true` → private,
 * `false` → brand). Assets without a brand_id are skipped (orphan rows
 * from pre-Phase-2 backfill — verified zero by `verify-migration.ts`).
 */
async function backfillCreated(pool, { dryRun }) {
  // `assets.created_at` is `timestamp without time zone` (Drizzle
  // `timestamp()` without `withTimezone: true`). When pg reads naïve
  // timestamps it constructs the JS Date via the LOCAL system TZ. Forcing
  // `AT TIME ZONE 'UTC'` makes pg return a `timestamptz` so the Date
  // round-trips losslessly. Without this, every backfilled `created_at`
  // drifts by `getTimezoneOffset()` minutes on non-UTC machines (PDT
  // dev laptop = +7h drift). Same fix in all 5 candidate queries below.
  const candidatesSql = `
    SELECT a.id, a.user_id, a.brand_id,
           a.created_at AT TIME ZONE 'UTC' AS created_at,
           a.media_type, a.source, b.workspace_id, b.is_personal
      FROM assets a
      INNER JOIN brands b ON b.id = a.brand_id
     WHERE b.workspace_id IS NOT NULL
  `;
  const inserted = await runInsertChunked(pool, {
    label: "generation.created",
    candidatesSql,
    rowToParams: (r) => ({
      backfill_key: `asset.created:${r.id}`,
      created_at: r.created_at,
      actor_id: r.user_id,
      verb: "generation.created",
      object_type: "asset",
      object_id: r.id,
      workspace_id: r.workspace_id,
      brand_id: r.brand_id,
      visibility: r.is_personal ? "private" : "brand",
      metadata: { source: r.source ?? null, mediaType: r.media_type ?? null },
    }),
    dryRun,
  });
  return inserted;
}

/**
 * Step 2 — review-log → generation.submitted | .approved | .rejected.
 * Skips archive/unarchive/fork/move actions — those don't surface in the
 * v1 verb set (FR-004).
 */
async function backfillReviewLog(pool, { dryRun }) {
  // `asset_review_log.created_at` is naïve timestamp — see TZ note in
  // backfillCreated above.
  const candidatesSql = `
    SELECT l.id, l.asset_id, l.actor_id, l.action, l.note,
           l.created_at AT TIME ZONE 'UTC' AS created_at,
           a.brand_id, b.workspace_id
      FROM asset_review_log l
      INNER JOIN assets a ON a.id = l.asset_id
      INNER JOIN brands b ON b.id = a.brand_id
     WHERE l.action IN ('submitted', 'approved', 'rejected')
       AND b.workspace_id IS NOT NULL
  `;
  return runInsertChunked(pool, {
    label: "generation.submitted|.approved|.rejected",
    candidatesSql,
    rowToParams: (r) => ({
      backfill_key: `review_log:${r.id}`,
      created_at: r.created_at,
      actor_id: r.actor_id,
      verb: `generation.${r.action}`, // submitted | approved | rejected
      object_type: "asset",
      object_id: r.asset_id,
      workspace_id: r.workspace_id,
      brand_id: r.brand_id,
      visibility: "brand",
      metadata: r.note ? { note: r.note } : {},
    }),
    dryRun,
  });
}

/**
 * Step 3 — generation.completed from generations.status='completed'.
 * Object is the generation itself; metadata.assetId mirrors live emission
 * so the UI dedupe (which suppresses .completed when a sibling .created
 * is on the same page) covers backfilled rows the same way.
 */
async function backfillCompleted(pool, { dryRun }) {
  // `generations.created_at` is naïve timestamp — same TZ fix as above.
  // (No `completed_at` column on `generations`; `created_at` is the
  // closest historical anchor — documented in Phase 6 decisions.)
  const candidatesSql = `
    SELECT g.id, g.user_id, g.asset_id,
           g.created_at AT TIME ZONE 'UTC' AS created_at,
           g.duration_ms, g.model,
           a.brand_id, a.media_type, b.workspace_id, b.is_personal
      FROM generations g
      INNER JOIN assets a ON a.id = g.asset_id
      INNER JOIN brands b ON b.id = a.brand_id
     WHERE g.status = 'completed'
       AND g.asset_id IS NOT NULL
       AND b.workspace_id IS NOT NULL
  `;
  return runInsertChunked(pool, {
    label: "generation.completed",
    candidatesSql,
    rowToParams: (r) => ({
      backfill_key: `generation.completed:${r.id}`,
      created_at: r.created_at, // generations has no completed_at; created_at is the closest historical anchor
      actor_id: r.user_id,
      verb: "generation.completed",
      object_type: "generation",
      object_id: r.id,
      workspace_id: r.workspace_id,
      brand_id: r.brand_id,
      visibility: r.is_personal ? "private" : "brand",
      metadata: {
        mediaType: r.media_type ?? null,
        model: r.model ?? null,
        assetId: r.asset_id,
        durationMs: r.duration_ms ?? null,
      },
    }),
    dryRun,
  });
}

/**
 * Step 4 — member.earned_feat from user_badges.
 *
 * `user_badges` is workspace-agnostic (XP/badges are global per-user). The
 * approximation is "the user's most-recently-created workspace_members
 * row" — same fallback `awardBadge()` uses at live-time when no workspace
 * is passed (see `resolveActivityWorkspaceId` in `src/lib/xp.ts`). Users
 * with zero memberships are skipped (rare; pre-bootstrap accounts only).
 *
 * Documented as an assumption in `progress.md`.
 */
async function backfillFeats(pool, { dryRun }) {
  const candidatesSql = `
    WITH primary_ws AS (
      SELECT DISTINCT ON (wm.user_id) wm.user_id, wm.workspace_id
        FROM workspace_members wm
       ORDER BY wm.user_id, wm.created_at DESC
    )
    SELECT ub.user_id, ub.badge_id,
           ub.earned_at AT TIME ZONE 'UTC' AS earned_at,
           pw.workspace_id,
           bd.name AS badge_name, bd.icon AS badge_icon
      FROM user_badges ub
      INNER JOIN primary_ws pw ON pw.user_id = ub.user_id
      INNER JOIN badges bd ON bd.id = ub.badge_id
  `;
  return runInsertChunked(pool, {
    label: "member.earned_feat",
    candidatesSql,
    rowToParams: (r) => ({
      backfill_key: `feat:${r.user_id}:${r.badge_id}`,
      created_at: r.earned_at,
      actor_id: r.user_id,
      verb: "member.earned_feat",
      object_type: "feat",
      object_id: r.badge_id, // text slug
      workspace_id: r.workspace_id,
      brand_id: null,
      visibility: "workspace",
      metadata: {
        feat: r.badge_id,
        name: r.badge_name,
        icon: r.badge_icon,
      },
    }),
    dryRun,
  });
}

/**
 * Step 5 — member.leveled_up by replaying xp_transactions per user.
 *
 * Streams xp_transactions ordered by (user_id, created_at) ASC so we can
 * accumulate a running total per user without holding all rows in memory
 * at once. For each transaction we compute the user's pre-tx and post-tx
 * level via `getLevelFromXP`; if the level increased, we emit one event
 * per crossed threshold (covers the rare case where a single transaction
 * vaults two levels — happens when admin-grants land a big chunk).
 *
 * `userXp` only stores the user's CURRENT level. Replay is the only way
 * to recover historical level-up timestamps, which is why this step
 * exists (and why it's the trickiest).
 */
async function backfillLevelUps(pool, { dryRun }) {
  const sql = `
    WITH primary_ws AS (
      SELECT DISTINCT ON (wm.user_id) wm.user_id, wm.workspace_id
        FROM workspace_members wm
       ORDER BY wm.user_id, wm.created_at DESC
    )
    SELECT t.user_id, t.amount,
           t.created_at AT TIME ZONE 'UTC' AS created_at,
           pw.workspace_id
      FROM xp_transactions t
      INNER JOIN primary_ws pw ON pw.user_id = t.user_id
     ORDER BY t.user_id, t.created_at, t.id
  `;
  const { rows } = await pool.query(sql);

  // Replay per user.
  const synthesized = [];
  let runningXp = 0;
  let runningUserId = null;
  let runningLevel = 1;
  for (const t of rows) {
    if (t.user_id !== runningUserId) {
      runningUserId = t.user_id;
      runningXp = 0;
      runningLevel = 1;
    }
    const prevLevel = runningLevel;
    runningXp += t.amount;
    const newLevel = getLevelFromXP(runningXp);
    if (newLevel > prevLevel) {
      // Emit one event per level crossed (handles big admin grants).
      for (let l = prevLevel + 1; l <= newLevel; l++) {
        synthesized.push({
          backfill_key: `level:${t.user_id}:${l}`,
          created_at: t.created_at,
          actor_id: t.user_id,
          verb: "member.leveled_up",
          object_type: "user",
          object_id: t.user_id,
          workspace_id: t.workspace_id,
          brand_id: null,
          visibility: "workspace",
          metadata: { level: l, title: getLevelTitle(l) },
        });
      }
      runningLevel = newLevel;
    }
  }

  if (dryRun) {
    return await dryRunReport(pool, "member.leveled_up", synthesized);
  }
  return await chunkInsertParams(pool, "member.leveled_up", synthesized);
}

// ----------------------------------------------------------------------------
// Insert helpers
// ----------------------------------------------------------------------------

async function runInsertChunked(pool, { label, candidatesSql, rowToParams, dryRun }) {
  const { rows } = await pool.query(candidatesSql);
  const params = rows.map(rowToParams);
  if (dryRun) {
    return await dryRunReport(pool, label, params);
  }
  return await chunkInsertParams(pool, label, params);
}

/**
 * In dry-run, report:
 *   - candidates: rows the candidate query returned
 *   - already_present: how many of those backfill_keys already exist in
 *     activity_events (would be skipped by ON CONFLICT)
 *   - would_write: candidates - already_present
 */
async function dryRunReport(pool, label, params) {
  if (params.length === 0) {
    return { label, candidates: 0, already_present: 0, would_write: 0 };
  }
  const keys = params.map((p) => p.backfill_key);
  let alreadyPresent = 0;
  // Probe in chunks too to keep the IN-list cheap.
  for (let i = 0; i < keys.length; i += 1000) {
    const slice = keys.slice(i, i + 1000);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n
         FROM activity_events
        WHERE backfill_key = ANY($1::text[])`,
      [slice]
    );
    alreadyPresent += rows[0].n;
  }
  return {
    label,
    candidates: params.length,
    already_present: alreadyPresent,
    would_write: params.length - alreadyPresent,
  };
}

/**
 * Insert the materialised `params` array in CHUNK_SIZE batches via a
 * single multi-row INSERT per chunk + ON CONFLICT DO NOTHING. Returns
 * { written, skipped } where `skipped = candidates - written`.
 */
async function chunkInsertParams(pool, label, params) {
  if (params.length === 0) {
    return { label, candidates: 0, written: 0, skipped: 0 };
  }
  let written = 0;
  for (let i = 0; i < params.length; i += CHUNK_SIZE) {
    const chunk = params.slice(i, i + CHUNK_SIZE);
    const sql = buildInsertSql(chunk);
    const values = flattenInsertValues(chunk);
    const result = await pool.query(sql, values);
    written += result.rowCount ?? 0;
  }
  return {
    label,
    candidates: params.length,
    written,
    skipped: params.length - written,
  };
}

const COLUMNS = [
  "backfill_key",
  "created_at",
  "actor_id",
  "verb",
  "object_type",
  "object_id",
  "workspace_id",
  "brand_id",
  "visibility",
  "metadata",
];

function buildInsertSql(chunk) {
  // Build $1..$N placeholders. metadata is jsonb; cast on the fly so pg
  // treats the JSON.stringify'd string correctly.
  const PLACEHOLDERS_PER_ROW = COLUMNS.length;
  const valueGroups = chunk
    .map((_row, rowIdx) => {
      const start = rowIdx * PLACEHOLDERS_PER_ROW;
      const placeholders = COLUMNS.map((col, i) => {
        const n = start + i + 1;
        return col === "metadata" ? `$${n}::jsonb` : `$${n}`;
      });
      return `(${placeholders.join(", ")})`;
    })
    .join(", ");
  return `
    INSERT INTO activity_events (${COLUMNS.join(", ")})
    VALUES ${valueGroups}
    ON CONFLICT (backfill_key) WHERE backfill_key IS NOT NULL DO NOTHING
    RETURNING id
  `;
}

function flattenInsertValues(chunk) {
  const out = [];
  for (const row of chunk) {
    out.push(
      row.backfill_key,
      row.created_at,
      row.actor_id,
      row.verb,
      row.object_type,
      row.object_id,
      row.workspace_id,
      row.brand_id, // pg accepts null here
      row.visibility,
      JSON.stringify(row.metadata ?? {})
    );
  }
  return out;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

function fmtRow(r) {
  if ("written" in r) {
    return `  ${r.label.padEnd(45)} candidates=${String(r.candidates).padStart(7)}  written=${String(r.written).padStart(7)}  skipped=${String(r.skipped).padStart(7)}`;
  }
  return `  ${r.label.padEnd(45)} candidates=${String(r.candidates).padStart(7)}  already=${String(r.already_present).padStart(7)}  would_write=${String(r.would_write).padStart(7)}`;
}

async function main() {
  await loadEnv();
  const { dryRun } = parseArgs();
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required (set in .env.local)");
    process.exit(2);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const t0 = performance.now();

  try {
    console.log(
      `[backfill-activity] ${dryRun ? "DRY RUN" : "APPLY"} — ${new Date().toISOString()}`
    );
    const results = [];
    results.push(await backfillCreated(pool, { dryRun }));
    results.push(await backfillReviewLog(pool, { dryRun }));
    results.push(await backfillCompleted(pool, { dryRun }));
    results.push(await backfillFeats(pool, { dryRun }));
    results.push(await backfillLevelUps(pool, { dryRun }));

    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    console.log("\n[backfill-activity] per-step results:");
    for (const r of results) console.log(fmtRow(r));
    const total = results.reduce(
      (acc, r) => acc + ("written" in r ? r.written : r.would_write),
      0
    );
    console.log(
      `\n[backfill-activity] ${dryRun ? "would write" : "wrote"} ${total} rows in ${elapsed}s`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[backfill-activity] crashed:", err);
  process.exit(1);
});
