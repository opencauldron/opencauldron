-- Migration 0010 — Constraint hardening for the agency DAM MVP.
--
-- Runs AFTER 0009 succeeds and `scripts/verify-migration.ts` confirms row-
-- count parity + the three-brand seed assertion. Each ALTER below assumes
-- 0009 left zero NULLs in the targeted columns.
--
-- Notes for the careful reader:
--   - The plan calls for `DROP COLUMN brews.is_public` (FR-041). Production
--     never had an `is_public` boolean — `brews.visibility` was added as a
--     text enum in migration 0006. 0009 backfilled the legacy `unlisted`
--     value to `brand`; this file does not touch the enum further. The TS
--     enum tightens (drop `unlisted`) once Phase 8c migrates the consumers.
--   - `asset_brands` is dropped here because the `assets.brand_id` FK is now
--     populated and the M2M junction is redundant.

-- 1. Tighten the columns whose 0009 backfill is now complete.
ALTER TABLE "assets"  ALTER COLUMN "brand_id"     SET NOT NULL;--> statement-breakpoint
ALTER TABLE "brands"  ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "brands"  ALTER COLUMN "slug"         SET NOT NULL;--> statement-breakpoint

-- 2. Self-FK on assets.parent_asset_id for fork lineage (FR-012).
ALTER TABLE "assets"
  ADD CONSTRAINT "assets_parent_asset_id_fk"
  FOREIGN KEY ("parent_asset_id") REFERENCES "assets"("id")
  ON DELETE SET NULL;--> statement-breakpoint

-- 3. Drop the legacy M2M junction now that the single FK is the source of truth.
DROP TABLE IF EXISTS "asset_brands";
