/**
 * revert-migration.ts — emergency reverse of the agency-DAM migration.
 *
 * ⚠️  DANGER ⚠️
 * This script DROPs columns + tables added by 0008 and CLEARs data backfilled
 * by 0009. Use only when 0009 fails partway and the verify script can't pass.
 * It is data-PRESERVING for the legacy (pre-agency) shape but DESTRUCTIVE of
 * any new agency-DAM data (workspaces, brand kits, review log, etc.).
 *
 * Always pair this with a Neon branch snapshot. If you have the snapshot,
 * prefer Neon's branch reset over this script.
 *
 * Usage:
 *   pnpm tsx scripts/revert-migration.ts --confirm
 */

import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.error(
      "Refusing to revert without --confirm. Read the script header before running."
    );
    process.exit(2);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL required");
    process.exit(2);
  }
  const pool = new Pool({ connectionString: url });

  try {
    console.log("Reverting agency-DAM migrations 0008/0009/0010...");

    // 0010 reversal — recreate asset_brands junction, copy brand_id back,
    // drop the FK constraints we added.
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'asset_brands') THEN
          CREATE TABLE asset_brands (
            asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
            brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
            PRIMARY KEY (asset_id, brand_id)
          );
          INSERT INTO asset_brands (asset_id, brand_id)
            SELECT id, brand_id FROM assets WHERE brand_id IS NOT NULL
            ON CONFLICT DO NOTHING;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.table_constraints
                    WHERE constraint_name = 'assets_parent_asset_id_fk') THEN
          ALTER TABLE assets DROP CONSTRAINT assets_parent_asset_id_fk;
        END IF;

        ALTER TABLE assets ALTER COLUMN brand_id DROP NOT NULL;
        ALTER TABLE brands ALTER COLUMN workspace_id DROP NOT NULL;
        ALTER TABLE brands ALTER COLUMN slug DROP NOT NULL;
      END $$;
    `);

    // 0009 reversal — clear backfilled data.
    await pool.query(`
      DELETE FROM brand_members;
      DELETE FROM brands WHERE is_personal = true;
      DELETE FROM brands WHERE name IN ('Taboo Grow','GIDDI','Cauldron')
        AND workspace_id = (SELECT id FROM workspaces WHERE slug = 'taboogrow');
      DELETE FROM workspace_members;
      DELETE FROM workspaces WHERE slug = 'taboogrow';

      UPDATE brews SET brand_id = NULL;
      UPDATE brews SET visibility = 'unlisted' WHERE visibility = 'brand';
      UPDATE assets SET brand_id = NULL;
      UPDATE assets SET status = 'draft' WHERE status = 'approved';
    `);

    // 0008 reversal — drop new tables and columns.
    await pool.query(`
      DROP TABLE IF EXISTS asset_collections CASCADE;
      DROP TABLE IF EXISTS collections CASCADE;
      DROP TABLE IF EXISTS asset_review_log CASCADE;
      DROP TABLE IF EXISTS brew_visibility_log CASCADE;
      DROP TABLE IF EXISTS uploads CASCADE;
      DROP TABLE IF EXISTS asset_campaigns CASCADE;
      DROP TABLE IF EXISTS campaigns CASCADE;
      DROP TABLE IF EXISTS brand_members CASCADE;
      DROP TABLE IF EXISTS workspace_members CASCADE;
      DROP TABLE IF EXISTS workspaces CASCADE;

      ALTER TABLE assets
        DROP COLUMN IF EXISTS brand_id,
        DROP COLUMN IF EXISTS parent_asset_id,
        DROP COLUMN IF EXISTS status,
        DROP COLUMN IF EXISTS source,
        DROP COLUMN IF EXISTS brand_kit_overridden,
        DROP COLUMN IF EXISTS updated_at;

      ALTER TABLE brands
        DROP COLUMN IF EXISTS workspace_id,
        DROP COLUMN IF EXISTS slug,
        DROP COLUMN IF EXISTS prompt_prefix,
        DROP COLUMN IF EXISTS prompt_suffix,
        DROP COLUMN IF EXISTS banned_terms,
        DROP COLUMN IF EXISTS default_lora_id,
        DROP COLUMN IF EXISTS default_lora_ids,
        DROP COLUMN IF EXISTS anchor_reference_ids,
        DROP COLUMN IF EXISTS palette,
        DROP COLUMN IF EXISTS self_approval_allowed,
        DROP COLUMN IF EXISTS video_enabled,
        DROP COLUMN IF EXISTS is_personal,
        DROP COLUMN IF EXISTS owner_id;

      ALTER TABLE brews DROP COLUMN IF EXISTS is_locked;
      ALTER TABLE references DROP COLUMN IF EXISTS brand_id;
    `);

    console.log("Revert complete.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("revert-migration crashed:", err);
  process.exit(2);
});
