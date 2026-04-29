/**
 * migrate-references-to-assets.ts — Phase 2 (T009) data backfill for the
 * Library / Unified DAM (specs/library-dam).
 *
 * Copies every row from `references` into `assets` (with source='uploaded'),
 * pairs it with an `uploads` row to preserve mime type + original filename,
 * and retargets every `brands.anchor_asset_ids` jsonb array from old
 * reference IDs to the new asset IDs via the `assets.legacy_reference_id`
 * map. One transaction per user — partial failures roll back per-user, the
 * rest of the run continues.
 *
 * Idempotency:
 *   - Each insert into `assets` skips rows whose `legacy_reference_id` is
 *     already present (enforced by the partial unique index from migration
 *     0016).
 *   - Each `brands` retarget is skipped when every entry in
 *     `anchor_asset_ids` already resolves to a valid `assets.id` (i.e. the
 *     retarget was already applied).
 *
 * Safety:
 *   - If any anchor ID fails to map (it's neither a known reference nor an
 *     existing asset), the brand is NOT updated. The bad IDs are reported
 *     in `unmappedAnchorIds`. Per-user transaction rolls back its own
 *     scope; the script keeps going for other users.
 *   - If a brand belongs to a different user than the references owner
 *     being processed, it's skipped and reported in `mismatchedUserScopes`.
 *
 * Usage:
 *   pnpm migrate-refs                       # production-style: writes JSON to stdout
 *   DATABASE_URL=... pnpm migrate-refs      # explicit DB
 */

import { Pool, type PoolClient } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

interface ReferenceRow {
  id: string;
  user_id: string;
  brand_id: string | null;
  r2_key: string;
  r2_url: string;
  thumbnail_r2_key: string | null;
  file_name: string | null;
  file_size: number | null;
  width: number | null;
  height: number | null;
  mime_type: string;
  usage_count: number;
  created_at: Date;
}

interface BrandRow {
  id: string;
  workspace_id: string | null;
  anchor_asset_ids: string[];
  // Owners-of-this-brand resolved via brand_members for scope-checking. We
  // only retarget brands whose member set overlaps with the references'
  // owner — otherwise we'd be touching another user's brand.
}

interface VerifierReport {
  usersProcessed: number;
  referencesIn: number;
  assetsInsertedThisRun: number;
  assetsAlreadyMigrated: number;
  brandsUpdated: number;
  anchorIdsRetargeted: number;
  unmappedAnchorIds: string[];
  mismatchedUserScopes: string[];
  errors: Array<{ userId?: string; brandId?: string; message: string }>;
}

function emptyReport(): VerifierReport {
  return {
    usersProcessed: 0,
    referencesIn: 0,
    assetsInsertedThisRun: 0,
    assetsAlreadyMigrated: 0,
    brandsUpdated: 0,
    anchorIdsRetargeted: 0,
    unmappedAnchorIds: [],
    mismatchedUserScopes: [],
    errors: [],
  };
}

async function listUsersWithReferences(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM "references" ORDER BY user_id`
  );
  return rows.map((r) => r.user_id);
}

async function fetchReferencesForUser(
  client: PoolClient,
  userId: string
): Promise<ReferenceRow[]> {
  const { rows } = await client.query<ReferenceRow>(
    `SELECT id, user_id, brand_id, r2_key, r2_url, thumbnail_r2_key,
            file_name, file_size, width, height, mime_type, usage_count,
            created_at
       FROM "references"
      WHERE user_id = $1
      ORDER BY created_at`,
    [userId]
  );
  return rows;
}

/**
 * Resolve the user's Personal brand id. The agency-DAM 0009 migration created
 * one Personal brand per user; references without an explicit brand fold
 * into it because `assets.brand_id` is NOT NULL post-0010.
 *
 * Returns null if no Personal brand can be found (caller logs an error and
 * skips that user — should never happen in practice; every user got a
 * Personal brand in 0009).
 */
async function resolvePersonalBrandId(
  client: PoolClient,
  userId: string
): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM "brands"
      WHERE owner_id = $1 AND is_personal = true
      ORDER BY created_at ASC
      LIMIT 1`,
    [userId]
  );
  return rows[0]?.id ?? null;
}

async function existingLegacyMap(
  client: PoolClient,
  userId: string
): Promise<Map<string, string>> {
  const { rows } = await client.query<{ id: string; legacy_reference_id: string }>(
    `SELECT id, legacy_reference_id FROM "assets"
      WHERE user_id = $1 AND legacy_reference_id IS NOT NULL`,
    [userId]
  );
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.legacy_reference_id, r.id);
  return map;
}

/**
 * Insert one reference into `assets` + `uploads`. Returns the new asset id,
 * OR null if the row was already migrated (idempotent skip).
 */
async function insertReferenceAsAsset(
  client: PoolClient,
  ref: ReferenceRow
): Promise<{ assetId: string; alreadyMigrated: boolean }> {
  // Idempotent guard via the partial unique index assets_legacy_reference_id_uniq.
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM "assets" WHERE legacy_reference_id = $1`,
    [ref.id]
  );
  if (existing.rowCount && existing.rows[0]) {
    return { assetId: existing.rows[0].id, alreadyMigrated: true };
  }

  // Image-only references (the legacy upload UI gates on this); media_type
  // = 'image' is correct for every backfilled row.
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO "assets" (
       user_id, brand_id, status, source, brand_kit_overridden, media_type,
       model, provider, prompt, parameters, r2_key, r2_url, thumbnail_r2_key,
       file_name, usage_count, width, height, file_size, cost_estimate,
       legacy_reference_id, created_at
     ) VALUES (
       $1, $2, 'draft', 'uploaded', false, 'image',
       'upload', 'upload', $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12, 0,
       $13, $14
     )
     RETURNING id`,
    [
      ref.user_id,
      ref.brand_id,
      // `prompt` is NOT NULL on assets; the original file name is the most
      // natural stand-in (the UI shows it as the asset title anyway).
      ref.file_name ?? "uploaded reference",
      // Stash original mime in `parameters` so it's preserved without
      // requiring a new column. The paired uploads row also keeps it.
      JSON.stringify({
        originalFilename: ref.file_name,
        contentType: ref.mime_type,
        legacyReferenceId: ref.id,
      }),
      ref.r2_key,
      ref.r2_url,
      ref.thumbnail_r2_key,
      ref.file_name,
      ref.usage_count,
      ref.width,
      ref.height,
      ref.file_size,
      ref.id,
      ref.created_at,
    ]
  );
  const assetId = inserted.rows[0].id;

  // Pair an `uploads` row so contentType + originalFilename live where the
  // existing upload code path expects them (the references table didn't
  // have a sibling table; uploads.assetId is unique-constrained).
  // ON CONFLICT DO NOTHING covers the rare race where someone re-runs a
  // partially-applied migration.
  await client.query(
    `INSERT INTO "uploads" (asset_id, uploader_id, original_filename, content_type, created_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (asset_id) DO NOTHING`,
    [
      assetId,
      ref.user_id,
      ref.file_name ?? "reference",
      ref.mime_type,
      ref.created_at,
    ]
  );

  return { assetId, alreadyMigrated: false };
}

/**
 * Retarget brand anchors for one user. Idempotent: if every anchor ID in a
 * brand already resolves to an existing asset, the brand is left alone.
 *
 * Returns counts so the verifier can report what changed.
 */
async function retargetBrandAnchors(
  client: PoolClient,
  userId: string,
  legacyMap: Map<string, string>,
  report: VerifierReport
) {
  // Find every brand that the user has a membership on (so we don't touch
  // brands that belong to a different workspace/user). The user is a
  // creator/manager via brand_members.
  const brandRows = await client.query<BrandRow>(
    `SELECT b.id, b.workspace_id, b.anchor_asset_ids
       FROM "brands" b
      WHERE EXISTS (
              SELECT 1 FROM "brand_members" bm
               WHERE bm.brand_id = b.id AND bm.user_id = $1
            )
        AND jsonb_array_length(COALESCE(b.anchor_asset_ids, '[]'::jsonb)) > 0`,
    [userId]
  );

  for (const brand of brandRows.rows) {
    const oldAnchors: string[] = brand.anchor_asset_ids ?? [];
    if (oldAnchors.length === 0) continue;

    const newAnchors: string[] = [];
    const unmapped: string[] = [];

    for (const oldId of oldAnchors) {
      // Path A: this id is a legacy reference id this user owns — remap.
      const mapped = legacyMap.get(oldId);
      if (mapped) {
        newAnchors.push(mapped);
        continue;
      }

      // Path B: already retargeted (asset id) — leave it. Verify it exists
      // so we don't propagate a stale id.
      const { rowCount } = await client.query(
        `SELECT 1 FROM "assets" WHERE id = $1`,
        [oldId]
      );
      if (rowCount && rowCount > 0) {
        newAnchors.push(oldId);
        continue;
      }

      // Path C: dangling pointer — neither a known reference for this user
      // nor a live asset. Report and refuse to write.
      unmapped.push(oldId);
    }

    if (unmapped.length > 0) {
      report.unmappedAnchorIds.push(...unmapped);
      report.errors.push({
        userId,
        brandId: brand.id,
        message: `Refusing to retarget brand ${brand.id}: ${unmapped.length} anchor id(s) failed to resolve`,
      });
      continue; // skip the write — caller's transaction stays clean for next brand
    }

    // Idempotency: if the array is unchanged (already retargeted), don't write.
    if (
      newAnchors.length === oldAnchors.length &&
      newAnchors.every((id, i) => id === oldAnchors[i])
    ) {
      continue;
    }

    await client.query(
      `UPDATE "brands" SET anchor_asset_ids = $1::jsonb WHERE id = $2`,
      [JSON.stringify(newAnchors), brand.id]
    );
    report.brandsUpdated += 1;
    // Count only the entries that actually changed pointer (i.e. were
    // legacy reference ids on the way in).
    for (let i = 0; i < oldAnchors.length; i += 1) {
      if (legacyMap.has(oldAnchors[i])) report.anchorIdsRetargeted += 1;
    }
  }
}

async function processUser(
  pool: Pool,
  userId: string,
  report: VerifierReport
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const refs = await fetchReferencesForUser(client, userId);
    report.referencesIn += refs.length;

    const legacyMap = await existingLegacyMap(client, userId);

    // assets.brand_id is NOT NULL post-0010. References with brand_id = NULL
    // fold into the user's Personal brand (mirrors the 0009 fold-in for
    // legacy generated assets).
    const personalBrandId = await resolvePersonalBrandId(client, userId);
    const needsPersonal = refs.some((r) => r.brand_id === null);
    if (needsPersonal && !personalBrandId) {
      throw new Error(
        `User ${userId} has null-brand references but no Personal brand — ` +
          `0009 backfill should have created one. Refusing to drop data.`
      );
    }

    for (const ref of refs) {
      const effectiveBrandId = ref.brand_id ?? personalBrandId!;
      const { assetId, alreadyMigrated } = await insertReferenceAsAsset(
        client,
        { ...ref, brand_id: effectiveBrandId }
      );
      legacyMap.set(ref.id, assetId);
      if (alreadyMigrated) {
        report.assetsAlreadyMigrated += 1;
      } else {
        report.assetsInsertedThisRun += 1;
      }
    }

    await retargetBrandAnchors(client, userId, legacyMap, report);

    await client.query("COMMIT");
    report.usersProcessed += 1;
  } catch (err) {
    await client.query("ROLLBACK");
    const message = err instanceof Error ? err.message : String(err);
    report.errors.push({ userId, message });
  } finally {
    client.release();
  }
}

export async function runMigration(
  pool: Pool
): Promise<VerifierReport> {
  const report = emptyReport();
  const userIds = await listUsersWithReferences(pool);

  for (const userId of userIds) {
    await processUser(pool, userId, report);
  }

  // Final orphan-anchor sweep: any brand whose anchor_asset_ids contains an
  // id that is NOT a known asset id is reported as a mismatched user scope.
  // (This catches the edge case where a brand is anchored to references
  // owned by a user who *isn't* a member of the brand — those are not
  // touched by per-user processing above.)
  const { rows: orphanRows } = await pool.query<{
    id: string;
    bad: string[];
  }>(
    `SELECT b.id,
            ARRAY(
              SELECT jsonb_array_elements_text(b.anchor_asset_ids)
              EXCEPT
              SELECT id::text FROM "assets"
            ) AS bad
       FROM "brands" b
      WHERE jsonb_array_length(COALESCE(b.anchor_asset_ids, '[]'::jsonb)) > 0`
  );
  for (const row of orphanRows) {
    if (row.bad.length === 0) continue;
    // Are any of these still references (i.e. owned by a user we never
    // processed)? If so, they're mismatched scopes.
    const stillRefs = await pool.query<{ id: string }>(
      `SELECT id FROM "references" WHERE id::text = ANY($1)`,
      [row.bad]
    );
    for (const r of stillRefs.rows) {
      report.mismatchedUserScopes.push(`brand=${row.id} ref=${r.id}`);
    }
  }

  return report;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL required");
    process.exit(2);
  }
  const pool = new Pool({ connectionString: url });
  try {
    const report = await runMigration(pool);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (report.errors.length > 0) process.exit(1);
  } finally {
    await pool.end();
  }
}

// Only run main() when invoked as a CLI; tests import runMigration directly.
const isCli = (() => {
  // tsx doesn't always set require.main, so check argv[1].
  if (typeof process === "undefined") return false;
  const entry = process.argv[1] ?? "";
  return entry.endsWith("migrate-references-to-assets.ts") ||
    entry.endsWith("migrate-references-to-assets.js") ||
    entry.endsWith("migrate-references-to-assets");
})();

if (isCli) {
  main().catch((err) => {
    console.error("migrate-references-to-assets crashed:", err);
    process.exit(2);
  });
}
