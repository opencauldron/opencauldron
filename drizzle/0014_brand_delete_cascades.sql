-- Migration 0014 — FK cascades for the "delete brand" path.
--
-- Background: deleting a brand fans out to assets → review_log / uploads /
-- asset_campaigns / asset_collections (cascaded already). The one missing
-- link is `generations.asset_id`: it was created with `ON DELETE no action`,
-- so removing an asset row blocks on the historical generation that
-- produced it. We don't want to wipe generation history when a brand goes
-- away — those rows are the audit trail for what was generated, including
-- xp_transactions linkage. So we relax the FK to ON DELETE SET NULL: the
-- generation row stays put, but its `asset_id` pointer goes null once the
-- asset is gone.
--
-- This is the only schema change required for the delete-brand path. The
-- delete handler does the rest of the work in the right order so the
-- existing cascades on `assets`, `brews`, `brand_members`, `campaigns`,
-- and `collections` clean up after themselves.

ALTER TABLE "generations"
  DROP CONSTRAINT IF EXISTS "generations_asset_id_assets_id_fk";--> statement-breakpoint

ALTER TABLE "generations"
  ADD CONSTRAINT "generations_asset_id_assets_id_fk"
  FOREIGN KEY ("asset_id") REFERENCES "assets"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
