-- Migration 0012 — Brand logos.
--
-- Adds `brands.logo_r2_key` (nullable) so brand managers can upload a logo
-- image that replaces the colored dot in the sidebar, brand page header, and
-- everywhere else a brand is rendered. We store the storage key (not the
-- URL) so signed R2 URLs are re-resolved on every read and never go stale.
--
-- Idempotent — safe to re-run.

ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "logo_r2_key" text;
