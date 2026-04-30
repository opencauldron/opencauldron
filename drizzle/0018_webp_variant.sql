-- Migration 0018 — WebP display variant + original mime-type lift.
--
-- Adds 5 nullable columns to `assets` to support the write-time WebP encoding
-- pipeline introduced in PR `feat/webp-image-delivery-backend`:
--
--   * webp_r2_key         — R2 key of the encoded display variant
--                           (`{originalKey}_display.webp`). Null for video
--                           assets and legacy image rows until the backfill
--                           script catches them.
--   * webp_file_size      — bytes; populated alongside webp_r2_key. Surfaced
--                           in the dual-format download menu in PR 2.
--   * webp_status         — 'pending' | 'ready' | 'failed' | NULL.
--                             - NULL  → not applicable (video) OR not yet
--                                       processed (legacy backlog).
--                             - 'pending' → backfill picked up the row but
--                                           hasn't completed (transient).
--                             - 'ready'   → webp_r2_key + webp_file_size
--                                           are populated and trustworthy.
--                             - 'failed'  → encoder threw; original is still
--                                           valid. Reason in webp_failed_reason.
--   * webp_failed_reason  — server-side error string. Never surfaced to users.
--   * original_mime_type  — lifted onto the asset row so the dual-format
--                           download UI can label "Original (PNG) · 14 MB"
--                           without joining `uploads` (which doesn't exist
--                           for `source = 'generated'` rows).
--
-- All columns nullable, additive only — no destructive ops, safe to deploy
-- before the encoder hook code is rolled out (existing rows stay null until
-- the backfill or new writes touch them; the application code tolerates null
-- via the `webpStatus IS NULL` branch in the API hydration layer).
--
-- Pattern note: text + Drizzle TS-level enum, NOT a Postgres ENUM type. This
-- matches the rest of the schema (`assets.status`, `assets.source`,
-- `users.role`, etc.). No CREATE TYPE — we let the application layer enforce
-- the value set, same as everywhere else.
--
-- Idempotent — every column add uses IF NOT EXISTS.

ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "webp_r2_key" text;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "webp_file_size" integer;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "webp_status" text;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "webp_failed_reason" text;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "original_mime_type" text;
