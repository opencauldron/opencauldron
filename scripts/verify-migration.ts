/**
 * verify-migration.ts — assert the agency-DAM migration left the DB in a
 * consistent state. Run AFTER 0009 succeeds and BEFORE 0010 hardens
 * constraints. Exits non-zero on any check failure.
 *
 * Usage:
 *   pnpm tsx scripts/verify-migration.ts
 *   pnpm tsx scripts/verify-migration.ts --smoke-public-slugs=https://studio.taboogrow.com
 *
 * Hard assertions:
 *   - Three seed brands (`Taboo Grow`, `GIDDI`, `OpenCauldron`) exist exactly once
 *     each in the bootstrap workspace (`taboogrow`).
 *   - Personal-brand count equals workspace_member count.
 *   - No orphan brews (`brand_id IS NULL`).
 *   - No orphan assets (`brand_id IS NULL`).
 *   - Brews visibility never `unlisted` (rewritten to `brand` in 0009).
 *   - Optional: public-slug smoke test against a deployed origin.
 */

import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

type Check = { label: string; ok: boolean; detail?: string };
const checks: Check[] = [];

function record(label: string, ok: boolean, detail?: string) {
  checks.push({ label, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function smokeTopSlugs(pool: Pool, origin: string) {
  const { rows } = await pool.query<{ slug: string }>(
    `SELECT slug FROM brews
      WHERE visibility = 'public' AND slug IS NOT NULL
      ORDER BY usage_count DESC NULLS LAST
      LIMIT 50`
  );
  if (rows.length === 0) {
    record("Public-slug smoke (no public slugs found)", true, "skipped");
    return;
  }
  let failed = 0;
  for (const { slug } of rows) {
    const url = `${origin.replace(/\/$/, "")}/brew/${slug}`;
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (!res.ok && res.status !== 405) failed += 1;
    } catch {
      failed += 1;
    }
  }
  record(
    `Public-slug smoke against ${origin} (${rows.length} slugs)`,
    failed === 0,
    `${failed} failed`
  );
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(2);
  }

  const smokeArg = process.argv.find((a) => a.startsWith("--smoke-public-slugs="));
  const smokeOrigin = smokeArg ? smokeArg.split("=")[1] : null;

  const pool = new Pool({ connectionString: url });

  console.log("Verifying agency-DAM migration state...\n");

  try {
    const { rows: wsRows } = await pool.query<{ id: string }>(
      `SELECT id FROM workspaces WHERE slug = 'taboogrow' LIMIT 1`
    );
    record("Bootstrap workspace `taboogrow` exists", wsRows.length === 1);
    const wsId = wsRows[0]?.id;

    if (wsId) {
      const { rows: seedRows } = await pool.query<{ name: string; cnt: number }>(
        `SELECT name, COUNT(*)::int AS cnt FROM brands
          WHERE workspace_id = $1 AND name IN ('Taboo Grow','GIDDI','OpenCauldron')
          GROUP BY name`,
        [wsId]
      );
      const want = ["Taboo Grow", "GIDDI", "OpenCauldron"];
      for (const name of want) {
        const row = seedRows.find((r) => r.name === name);
        record(
          `Seed brand "${name}" present exactly once`,
          !!row && row.cnt === 1,
          row ? `count=${row.cnt}` : "missing"
        );
      }

      const { rows: personalRows } = await pool.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM brands WHERE workspace_id = $1 AND is_personal = true`,
        [wsId]
      );
      const { rows: memberRows } = await pool.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM workspace_members WHERE workspace_id = $1`,
        [wsId]
      );
      record(
        "Personal brand per workspace member",
        personalRows[0].cnt === memberRows[0].cnt,
        `personal=${personalRows[0].cnt}, members=${memberRows[0].cnt}`
      );
    }

    const { rows: orphanBrews } = await pool.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM brews WHERE brand_id IS NULL`
    );
    record("No orphan brews (brand_id NULL)", orphanBrews[0].cnt === 0,
      `count=${orphanBrews[0].cnt}`);

    const { rows: orphanAssets } = await pool.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM assets WHERE brand_id IS NULL`
    );
    record("No orphan assets (brand_id NULL)", orphanAssets[0].cnt === 0,
      `count=${orphanAssets[0].cnt}`);

    const { rows: legacyVisibility } = await pool.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM brews WHERE visibility = 'unlisted'`
    );
    record(
      "Legacy `unlisted` brew visibility rewritten",
      legacyVisibility[0].cnt === 0,
      `count=${legacyVisibility[0].cnt}`
    );

    const { rows: nullVisibility } = await pool.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM brews WHERE visibility IS NULL`
    );
    record("Brews visibility populated", nullVisibility[0].cnt === 0,
      `count=${nullVisibility[0].cnt}`);

    if (smokeOrigin) await smokeTopSlugs(pool, smokeOrigin);
  } finally {
    await pool.end();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);

  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed — DO NOT run 0010 yet.`);
    process.exit(1);
  }
  console.log("\nAll checks passed. Safe to proceed with 0010_constraint_hardening.");
}

main().catch((err) => {
  console.error("verify-migration crashed:", err);
  process.exit(2);
});
