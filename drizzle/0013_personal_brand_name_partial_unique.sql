-- Migration 0013 — make the brand-name uniqueness partial.
--
-- 0008 created `brands_workspace_name_unique ON (workspace_id, name)` as a
-- plain unique index. That's incompatible with the personal-brand pattern:
-- every user gets a brand literally named "Personal", and a workspace can
-- have many of them (one per member). The plain unique index blocked the
-- second user's bootstrap.
--
-- Fix: scope uniqueness to non-personal brands. Real brands still must have
-- distinct names within a workspace; personal brands are exempt.
DROP INDEX IF EXISTS "brands_workspace_name_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "brands_workspace_name_unique"
  ON "brands" USING btree ("workspace_id","name")
  WHERE "is_personal" = false;
