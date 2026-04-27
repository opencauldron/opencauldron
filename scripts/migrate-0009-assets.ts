/**
 * migrate-0009-assets.ts — supplemental procedural step for the agency-DAM
 * data backfill (T021).
 *
 * The 0009 SQL handles the common case (every legacy `assets` row gets folded
 * into Taboo Grow, taking the FIRST entry from the legacy `asset_brands`
 * junction if one exists). This script exists for the rare edge cases where
 * an operator needs to inspect or manually re-resolve those decisions before
 * 0010 hardens the FK.
 *
 * Idempotent: skips rows where `assets.brand_id` is already populated.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-0009-assets.ts            # dry-run
 *   pnpm tsx scripts/migrate-0009-assets.ts --apply    # actually update
 */

import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL required");
    process.exit(2);
  }
  const apply = process.argv.includes("--apply");
  const pool = new Pool({ connectionString: url });

  try {
    const { rows } = await pool.query<{
      id: string;
      brand_id: string | null;
      junction_brand: string | null;
    }>(
      `SELECT a.id, a.brand_id,
              (SELECT brand_id FROM asset_brands ab
                WHERE ab.asset_id = a.id
                ORDER BY brand_id ASC
                LIMIT 1) AS junction_brand
         FROM assets a
        WHERE a.brand_id IS NULL
        LIMIT 1000`
    );

    if (rows.length === 0) {
      console.log("All assets have brand_id populated. Nothing to do.");
      return;
    }

    console.log(`Found ${rows.length} asset(s) with brand_id IS NULL.`);
    if (!apply) {
      console.log("Re-run with --apply to update.");
      return;
    }

    for (const row of rows) {
      if (!row.junction_brand) continue;
      await pool.query(`UPDATE assets SET brand_id = $1 WHERE id = $2`, [
        row.junction_brand,
        row.id,
      ]);
    }
    console.log(`Updated ${rows.length} asset row(s) from asset_brands junction.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("migrate-0009-assets crashed:", err);
  process.exit(2);
});
