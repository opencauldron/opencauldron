-- Migration 0011 — Studio settings.
--
-- Two tiny changes:
--   1. Add `workspaces.logo_url` (nullable) so admins can pin a studio logo
--      from the new /settings/studio page.
--   2. Backfill the legacy `My Workspace` default name to `My Studio`. The
--      bootstrap helper (`bootstrapHostedSignup`) now seeds `My Studio` for
--      new accounts; this update only touches rows that still carry the old
--      placeholder so user-renamed studios are left alone.
--
-- Both statements are idempotent — re-running is a no-op.

ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "logo_url" text;
--> statement-breakpoint
UPDATE "workspaces" SET "name" = 'My Studio' WHERE "name" = 'My Workspace';
