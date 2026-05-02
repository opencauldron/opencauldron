-- Migration 0023 — Activity Events (append-only feed ledger).
--
-- Adds a single table `activity_events` plus five indexes. Per spec FR-001
-- the table is APPEND-ONLY: rows are immutable. The only writers are
-- `emitActivity()` in `src/lib/activity.ts` and the one-shot
-- `scripts/backfill-activity.ts`. A CI grep guard
-- (`scripts/check-activity-append-only.ts`) flags any UPDATE/DELETE outside
-- those two files; see the comment block on the `activityEvents` table in
-- `src/lib/db/schema.ts`.
--
-- HAND-WRITTEN — drizzle-kit generate is blocked on a pre-existing snapshot
-- collision (`0008/0009/0010_snapshot.json`) that's out of scope for this
-- PR. The migration matches the column / index conventions used by 0020
-- (asset_threads schema): `IF NOT EXISTS`, snake_case columns, timestamptz
-- with DEFAULT now(), and the standard Drizzle statement-breakpoint
-- separators so drizzle-kit migrate applies each statement individually.
--
-- `verb` and `visibility` are plain `text` columns with no DB-level CHECK —
-- the Drizzle TS enum in `schema.ts` is the only gate (matches the
-- `notifications.type` and `assets.status` convention). Adding a verb is
-- therefore a code change, not a migration.
--
-- Idempotent: every CREATE uses `IF NOT EXISTS`. Re-running on a partially
-- applied DB completes the missing pieces without raising.

CREATE TABLE IF NOT EXISTS "activity_events" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "actor_id"      uuid NOT NULL REFERENCES "users"("id"),
  "verb"          text NOT NULL,
  "object_type"   text NOT NULL,
  -- text (not uuid): badges.id is a text slug like 'first-brew'. The
  -- polymorphic target is intentionally stringly-typed; consumers parse
  -- the value based on `object_type`. See spec FR-005 + plan key decision
  -- "polymorphic (object_type, object_id)".
  "object_id"     text NOT NULL,
  "workspace_id"  uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "brand_id"      uuid REFERENCES "brands"("id") ON DELETE SET NULL,
  "visibility"    text NOT NULL,
  "metadata"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "backfill_key"  text
);
--> statement-breakpoint

-- Hot read paths — each tab + the actor "for-you" union has its own dominant
-- where-clause, so each gets its own index. `created_at DESC` matches the
-- query planner exactly for the `ORDER BY created_at DESC, id DESC` cursor
-- pagination used by every feed query.

CREATE INDEX IF NOT EXISTS "activity_events_actor_created_idx"
  ON "activity_events" ("actor_id", "created_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "activity_events_workspace_created_idx"
  ON "activity_events" ("workspace_id", "created_at" DESC);
--> statement-breakpoint

-- Partial — `brand_id` is null for workspace-scoped verbs (level-ups, feats).
CREATE INDEX IF NOT EXISTS "activity_events_brand_created_idx"
  ON "activity_events" ("brand_id", "created_at" DESC)
  WHERE "brand_id" IS NOT NULL;
--> statement-breakpoint

-- Composite for the workspace + my-brands tab queries which filter on
-- visibility before workspace.
CREATE INDEX IF NOT EXISTS "activity_events_visibility_workspace_created_idx"
  ON "activity_events" ("visibility", "workspace_id", "created_at" DESC);
--> statement-breakpoint

-- Partial unique — backfill idempotency. Live emissions leave `backfill_key`
-- null (no constraint applies); the backfill script populates it with a
-- deterministic string so re-runs ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS "activity_events_backfill_key_unique"
  ON "activity_events" ("backfill_key")
  WHERE "backfill_key" IS NOT NULL;
