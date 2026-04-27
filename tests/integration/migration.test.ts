/**
 * Integration test for the agency-DAM migration trio (0008/0009/0010).
 *
 * Skipped unless `INTEGRATION_DATABASE_URL` is set. Spins up nothing on its
 * own — point it at a disposable Postgres (Neon dev branch, local docker).
 * The test:
 *   1. Truncates everything in the target DB.
 *   2. Replays migrations 0000 → 0007 to land at the legacy baseline.
 *   3. Inserts a small fixture (one user, one legacy brew, one legacy asset).
 *   4. Runs 0008 (additive), 0009 (backfill), then verifies invariants
 *      WITHOUT running 0010 (the verify step is the gate).
 *   5. Runs 0010 and asserts NOT NULL constraints + asset_brands drop.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const url = process.env.INTEGRATION_DATABASE_URL;
const enabled = !!url;
const pool = enabled ? new Pool({ connectionString: url }) : null;

const migrationsDir = path.join(process.cwd(), "drizzle");

async function exec(sqlText: string) {
  if (!pool) throw new Error("pool unset");
  // Split on Drizzle's statement-breakpoint marker. 0009 is one DO block —
  // no breakpoints — so a no-op split keeps the whole script as one stmt.
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

describe.skipIf(!enabled)("agency-DAM migration", () => {
  beforeAll(async () => {
    if (!enabled) return;
    await freshDb();
    // Replay legacy migrations to land at the baseline.
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql") && /^00\d\d_/.test(f))
      .sort();
    for (const f of files) {
      const tag = f.replace(/\.sql$/, "");
      const idx = parseInt(tag.split("_")[0], 10);
      if (idx <= 7) await applyMigration(f);
    }
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it("0008 lands additive columns + new tables", async () => {
    if (!pool) return;
    await applyMigration("0008_workspace_additive.sql");

    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN
          ('workspaces','workspace_members','brand_members','campaigns',
           'asset_campaigns','uploads','asset_review_log','brew_visibility_log',
           'collections','asset_collections')`
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual([
      "asset_campaigns",
      "asset_collections",
      "asset_review_log",
      "brand_members",
      "brew_visibility_log",
      "campaigns",
      "collections",
      "uploads",
      "workspace_members",
      "workspaces",
    ]);
  }, 30_000);

  it("0009 seeds three brands + workspace + Personal brands", async () => {
    if (!pool) return;
    // Insert a tiny fixture to exercise the data backfill.
    await pool.query(
      `INSERT INTO users (email, name, role) VALUES ('test@example.com','Test','member')`
    );
    await applyMigration("0009_data_backfill.sql");

    const ws = await pool.query(
      `SELECT id FROM workspaces WHERE slug = 'taboogrow'`
    );
    expect(ws.rowCount).toBe(1);

    const brandsCount = await pool.query<{ name: string; cnt: string }>(
      `SELECT name, COUNT(*) AS cnt FROM brands
        WHERE workspace_id = $1 AND name IN ('Taboo Grow','GIDDI','Cauldron')
        GROUP BY name`,
      [ws.rows[0].id]
    );
    expect(brandsCount.rowCount).toBe(3);

    const personals = await pool.query(
      `SELECT 1 FROM brands WHERE is_personal = true`
    );
    expect(personals.rowCount).toBe(1);
  }, 30_000);

  it("0010 hardens NOT NULL + drops asset_brands", async () => {
    if (!pool) return;
    await applyMigration("0010_constraint_hardening.sql");

    const { rows } = await pool.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_name = 'assets' AND column_name = 'brand_id'`
    );
    expect(rows[0].is_nullable).toBe("NO");

    const ab = await pool.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_name = 'asset_brands'`
    );
    expect(ab.rowCount).toBe(0);
  }, 30_000);
});
