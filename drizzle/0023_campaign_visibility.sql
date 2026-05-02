-- Migration 0023 — Public campaign galleries (`spec/public-campaign-galleries`).
--
-- Adds two columns to `campaigns` plus a global unique index on the public
-- slug. See `specs/public-campaign-galleries/plan.md` D7 for the schema
-- decision and `spec.md` FR-001 for the contract.
--
-- Notes:
--   - `pnpm drizzle-kit generate` is currently unusable on this repo due to
--     pre-existing snapshot-id collisions in drizzle/meta/0008..0010
--     (data-only migrations produced identical snapshot IDs). The team has
--     hand-written every migration since 0013; this one follows the same
--     pattern. See progress.md for the deviation note.
--   - All existing campaigns get `visibility = 'private'` via the column
--     default; no backfill needed (per plan.md D7 "No backfill").
--   - `public_slug` stays NULL until the first publish; the unique index
--     allows multiple NULLs (Postgres default behavior for NULL values in
--     unique indexes), which is exactly what we want — many private
--     campaigns coexist, each public campaign owns a globally unique slug.
ALTER TABLE "campaigns" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "public_slug" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_public_slug_unique" ON "campaigns" USING btree ("public_slug");
