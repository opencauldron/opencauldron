/**
 * Integration test for the references → assets backfill (T010).
 *
 * Skipped unless `INTEGRATION_DATABASE_URL` is set. Mirrors the pattern in
 * `migration.test.ts`: point the env var at a disposable Postgres (Neon
 * preview branch, local docker), the test wipes the schema and replays
 * every drizzle migration up to 0016 to land at the post-Phase-2 baseline,
 * seeds fixtures, and exercises `runMigration`.
 *
 * Fixtures match the spec's T010 acceptance matrix:
 *   A. ref with brandId, brand has the ref as anchor → asset created, brand
 *      anchor retargeted to the new asset id.
 *   B. ref without brandId → asset created, no brand touched.
 *   C. brand with mixed anchors (some refs we own, some unrelated UUIDs) →
 *      unrelated UUIDs are reported as `unmappedAnchorIds`, brand row is
 *      NOT updated, error logged.
 *   D. re-run after fixture A → 0 inserts, verifier reports
 *      `assetsAlreadyMigrated > 0` and brand anchors unchanged.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { runMigration } from "../../scripts/migrate-references-to-assets";

dotenv.config({ path: ".env.local" });

const url = process.env.INTEGRATION_DATABASE_URL;
const enabled = !!url;
const pool = enabled ? new Pool({ connectionString: url }) : null;

const migrationsDir = path.join(process.cwd(), "drizzle");

async function exec(sqlText: string) {
  if (!pool) throw new Error("pool unset");
  const stmts = sqlText
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of stmts) {
    await pool.query(stmt);
  }
}

async function applyMigration(file: string) {
  const sqlText = fs.readFileSync(path.join(migrationsDir, file), "utf8");
  await exec(sqlText);
}

async function freshDb() {
  if (!pool) return;
  await pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
}

async function applyAllMigrationsThrough(maxIdx: number) {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const idx = parseInt(f.split("_")[0], 10);
    if (Number.isNaN(idx) || idx > maxIdx) continue;
    await applyMigration(f);
  }
}

interface Fixture {
  userId: string;
  workspaceId: string;
  brandWithAnchor: string;
  brandWithoutAnchor: string;
  brandWithMixedAnchors: string;
  refWithBrand: string;       // anchored on brandWithAnchor
  refWithoutBrand: string;    // no brand
  refForMixedBrand: string;   // anchored on brandWithMixedAnchors (alongside random uuid)
  unrelatedUuid: string;
}

async function seedFixture(): Promise<Fixture> {
  if (!pool) throw new Error("pool unset");

  // User + workspace + workspace membership
  const { rows: userRows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, role) VALUES ('test@example.com','Test','member') RETURNING id`
  );
  const userId = userRows[0].id;

  const { rows: wsRows } = await pool.query<{ id: string }>(
    `INSERT INTO workspaces (name, slug, mode, created_by)
     VALUES ('Test WS', 'test-ws', 'hosted', $1)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [userId]
  );
  const workspaceId = wsRows[0].id;

  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT DO NOTHING`,
    [workspaceId, userId]
  );

  // Personal brand — matches the reality of 0009 backfill. References without
  // brand_id fold into this so the assets.brand_id NOT NULL constraint passes.
  await pool.query(
    `INSERT INTO brands (workspace_id, name, slug, color, is_personal, owner_id, created_by)
     VALUES ($1::uuid, 'Personal', 'personal-' || substr($2::text, 1, 8),
             '#94a3b8', true, $2::uuid, $2::uuid)`,
    [workspaceId, userId]
  );

  // Three brands. brand_members rows so the migration finds them.
  const { rows: bA } = await pool.query<{ id: string }>(
    `INSERT INTO brands (workspace_id, name, slug, color, created_by)
     VALUES ($1, 'Brand A', 'brand-a', '#000000', $2) RETURNING id`,
    [workspaceId, userId]
  );
  const { rows: bB } = await pool.query<{ id: string }>(
    `INSERT INTO brands (workspace_id, name, slug, color, created_by)
     VALUES ($1, 'Brand B', 'brand-b', '#000000', $2) RETURNING id`,
    [workspaceId, userId]
  );
  const { rows: bC } = await pool.query<{ id: string }>(
    `INSERT INTO brands (workspace_id, name, slug, color, created_by)
     VALUES ($1, 'Brand C', 'brand-c', '#000000', $2) RETURNING id`,
    [workspaceId, userId]
  );
  const brandWithAnchor = bA[0].id;
  const brandWithoutAnchor = bB[0].id;
  const brandWithMixedAnchors = bC[0].id;

  for (const id of [brandWithAnchor, brandWithoutAnchor, brandWithMixedAnchors]) {
    await pool.query(
      `INSERT INTO brand_members (brand_id, user_id, role)
       VALUES ($1, $2, 'brand_manager')`,
      [id, userId]
    );
  }

  // References — three rows.
  const { rows: r1 } = await pool.query<{ id: string }>(
    `INSERT INTO "references" (user_id, brand_id, r2_key, r2_url, mime_type, file_name, file_size, width, height, usage_count)
     VALUES ($1, $2, 'r2/k1', 'https://r2/k1', 'image/png', 'a.png', 1234, 800, 600, 3)
     RETURNING id`,
    [userId, brandWithAnchor]
  );
  const refWithBrand = r1[0].id;

  const { rows: r2 } = await pool.query<{ id: string }>(
    `INSERT INTO "references" (user_id, r2_key, r2_url, mime_type, file_name)
     VALUES ($1, 'r2/k2', 'https://r2/k2', 'image/jpeg', 'b.jpg')
     RETURNING id`,
    [userId]
  );
  const refWithoutBrand = r2[0].id;

  const { rows: r3 } = await pool.query<{ id: string }>(
    `INSERT INTO "references" (user_id, brand_id, r2_key, r2_url, mime_type, file_name)
     VALUES ($1, $2, 'r2/k3', 'https://r2/k3', 'image/webp', 'c.webp')
     RETURNING id`,
    [userId, brandWithMixedAnchors]
  );
  const refForMixedBrand = r3[0].id;

  // Brand A anchored on r1 only.
  await pool.query(
    `UPDATE brands SET anchor_asset_ids = $1::jsonb WHERE id = $2`,
    [JSON.stringify([refWithBrand]), brandWithAnchor]
  );

  // Brand C anchored on r3 + a random unrelated uuid (fixture C invariant).
  const unrelatedUuid = "11111111-2222-3333-4444-555555555555";
  await pool.query(
    `UPDATE brands SET anchor_asset_ids = $1::jsonb WHERE id = $2`,
    [JSON.stringify([refForMixedBrand, unrelatedUuid]), brandWithMixedAnchors]
  );

  return {
    userId,
    workspaceId,
    brandWithAnchor,
    brandWithoutAnchor,
    brandWithMixedAnchors,
    refWithBrand,
    refWithoutBrand,
    refForMixedBrand,
    unrelatedUuid,
  };
}

describe.skipIf(!enabled)("migrate-references-to-assets (T009/T010)", () => {
  let fixture: Fixture;

  beforeAll(async () => {
    if (!pool) return;
    await freshDb();
    await applyAllMigrationsThrough(16);
  }, 120_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    if (!pool) return;
    // Clear data tables but leave schema intact between fixture runs.
    await pool.query(`
      TRUNCATE TABLE "uploads", "asset_review_log", "asset_campaigns",
        "asset_collections", "asset_tags", "generations", "assets",
        "campaigns", "brand_members", "references", "brands",
        "workspace_members", "workspaces", "users"
        RESTART IDENTITY CASCADE
    `);
    fixture = await seedFixture();
  }, 60_000);

  it("Fixture A: ref+brand → asset created, brand anchor retargeted", async () => {
    if (!pool) return;
    const report = await runMigration(pool);

    // The seed deliberately includes the Fixture C scenario (mixed anchors
    // with an unrelated uuid). Errors scoped to that brand are expected;
    // assert no *user-level* errors.
    const userLevelErrors = report.errors.filter((e) => !e.brandId);
    expect(userLevelErrors).toEqual([]);
    expect(report.usersProcessed).toBe(1);
    expect(report.referencesIn).toBe(3);
    expect(report.assetsInsertedThisRun).toBe(3);
    expect(report.assetsAlreadyMigrated).toBe(0);
    expect(report.brandsUpdated).toBeGreaterThanOrEqual(1);

    const { rows: assetForA } = await pool.query<{ id: string }>(
      `SELECT id FROM "assets" WHERE legacy_reference_id = $1`,
      [fixture.refWithBrand]
    );
    expect(assetForA).toHaveLength(1);
    const newAssetId = assetForA[0].id;

    const { rows: brandRows } = await pool.query<{ anchor_asset_ids: string[] }>(
      `SELECT anchor_asset_ids FROM "brands" WHERE id = $1`,
      [fixture.brandWithAnchor]
    );
    expect(brandRows[0].anchor_asset_ids).toEqual([newAssetId]);

    // Asset row carries the right metadata.
    const { rows: assetMeta } = await pool.query<{
      source: string;
      file_name: string | null;
      file_size: number | null;
      width: number | null;
      height: number | null;
      usage_count: number;
      brand_id: string | null;
    }>(
      `SELECT source, file_name, file_size, width, height, usage_count, brand_id
         FROM "assets" WHERE id = $1`,
      [newAssetId]
    );
    expect(assetMeta[0].source).toBe("uploaded");
    expect(assetMeta[0].file_name).toBe("a.png");
    expect(assetMeta[0].file_size).toBe(1234);
    expect(assetMeta[0].width).toBe(800);
    expect(assetMeta[0].height).toBe(600);
    expect(assetMeta[0].usage_count).toBe(3);
    expect(assetMeta[0].brand_id).toBe(fixture.brandWithAnchor);
  });

  it("Fixture B: ref without brandId → asset created, no brand touched", async () => {
    if (!pool) return;
    const report = await runMigration(pool);
    // user-level errors only — brand-scoped errors come from Fixture C and
    // are expected to coexist with this assertion.
    const userLevelErrors = report.errors.filter((e) => !e.brandId);
    expect(userLevelErrors).toEqual([]);

    const { rows } = await pool.query<{
      brand_id: string | null;
      file_name: string | null;
    }>(
      `SELECT brand_id, file_name FROM "assets"
        WHERE legacy_reference_id = $1`,
      [fixture.refWithoutBrand]
    );
    expect(rows).toHaveLength(1);
    // Folded into the user's Personal brand (fixture seeded one to match
    // the post-0009 production reality).
    expect(rows[0].brand_id).not.toBeNull();
    expect(rows[0].file_name).toBe("b.jpg");

    // brandWithoutAnchor was never touched (still empty array).
    const { rows: brandRows } = await pool.query<{
      anchor_asset_ids: string[];
    }>(
      `SELECT anchor_asset_ids FROM "brands" WHERE id = $1`,
      [fixture.brandWithoutAnchor]
    );
    expect(brandRows[0].anchor_asset_ids).toEqual([]);
  });

  it("Fixture C: brand with mixed anchors → unmapped reported, brand NOT updated", async () => {
    if (!pool) return;
    const report = await runMigration(pool);

    // Refs themselves all migrate fine.
    expect(report.assetsInsertedThisRun).toBe(3);

    // The unrelated uuid is reported.
    expect(report.unmappedAnchorIds).toContain(fixture.unrelatedUuid);

    // An error was logged for the mixed brand.
    expect(
      report.errors.some(
        (e) =>
          e.brandId === fixture.brandWithMixedAnchors &&
          /Refusing to retarget/.test(e.message)
      )
    ).toBe(true);

    // The brand was NOT modified — anchor array still contains the original
    // reference id (unmapped legacy id) and the unrelated uuid.
    const { rows } = await pool.query<{ anchor_asset_ids: string[] }>(
      `SELECT anchor_asset_ids FROM "brands" WHERE id = $1`,
      [fixture.brandWithMixedAnchors]
    );
    expect(rows[0].anchor_asset_ids).toEqual([
      fixture.refForMixedBrand,
      fixture.unrelatedUuid,
    ]);
  });

  it("Fixture D: re-run is idempotent (0 inserts, alreadyMigrated > 0)", async () => {
    if (!pool) return;
    const first = await runMigration(pool);
    expect(first.assetsInsertedThisRun).toBe(3);
    expect(first.assetsAlreadyMigrated).toBe(0);

    const second = await runMigration(pool);
    expect(second.assetsInsertedThisRun).toBe(0);
    expect(second.assetsAlreadyMigrated).toBe(3);
    // Brand anchors stay retargeted.
    const { rows } = await pool.query<{ anchor_asset_ids: string[] }>(
      `SELECT anchor_asset_ids FROM "brands" WHERE id = $1`,
      [fixture.brandWithAnchor]
    );
    expect(rows[0].anchor_asset_ids).toHaveLength(1);
    // No new errors on re-run.
    expect(second.errors.filter((e) => !e.brandId)).toEqual([]);
  });
});
