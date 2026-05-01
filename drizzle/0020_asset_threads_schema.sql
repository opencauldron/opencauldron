-- Migration 0018 — Asset Message Threads schema (Phase 2 / Foundation).
--
-- Adds five tables (asset_threads, messages, message_reactions,
-- message_mentions, message_attachments) and extends notifications.type with
-- two new values (thread_mention, thread_reply). Reversible up to the data
-- inserts the schema enables — i.e. dropping the tables is safe before any
-- thread row exists; once messages land the rollback is destructive.
--
-- Idempotent: every CREATE uses IF NOT EXISTS / DO blocks. Re-running the
-- migration on a partially-applied DB completes the missing pieces without
-- raising. The notifications.type column is plain `text` (no DB-level CHECK
-- — see migration 0015), so the new `thread_mention` / `thread_reply`
-- values need no DDL here; the drizzle/TS enum in `schema.ts` is the gate.
--
-- DO NOT APPLY without first running on a Neon preview branch and verifying:
--   * pg_notify('thread_events', '{}') succeeds end-to-end through the
--     direct (non-pooler) Neon endpoint — see scripts/spike-listen-notify.ts.
--   * The five new tables exist with the expected columns + indexes.
--   * Inserting a notification row with type='thread_mention' or
--     'thread_reply' does NOT raise (the column has no CHECK).

-- ============================================================
-- 1. asset_threads — 1:1 with assets, lazy-created on first message.
-- ============================================================

CREATE TABLE IF NOT EXISTS "asset_threads" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "asset_id"         uuid NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE,
  "workspace_id"     uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "message_count"    integer NOT NULL DEFAULT 0,
  "last_message_at"  timestamptz,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "asset_threads_asset_id_unique" UNIQUE ("asset_id")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "asset_threads_workspace_idx"
  ON "asset_threads" ("workspace_id");
--> statement-breakpoint

-- ============================================================
-- 2. messages — one row per message; replies use parent_message_id; soft
-- delete via deleted_at (body is scrubbed to NULL on soft-delete).
-- ============================================================

CREATE TABLE IF NOT EXISTS "messages" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "thread_id"           uuid NOT NULL REFERENCES "asset_threads"("id") ON DELETE CASCADE,
  -- Denormalized from asset_threads.workspace_id for permission checks +
  -- index locality. Maintained at insert time; an asset can't move workspaces.
  "workspace_id"        uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "author_id"           uuid NOT NULL REFERENCES "users"("id"),
  "parent_message_id"   uuid REFERENCES "messages"("id") ON DELETE SET NULL,
  "body"                text,
  "edited_at"           timestamptz,
  "deleted_at"          timestamptz,
  "created_at"          timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Hot read path: latest N per thread. Order is (created_at desc, id desc) so
-- the index is naturally a perfect match for the query planner.
CREATE INDEX IF NOT EXISTS "messages_thread_created_idx"
  ON "messages" ("thread_id", "created_at" DESC, "id" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "messages_parent_idx"
  ON "messages" ("parent_message_id")
  WHERE "parent_message_id" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "messages_author_idx"
  ON "messages" ("author_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "messages_workspace_idx"
  ON "messages" ("workspace_id");
--> statement-breakpoint

-- ============================================================
-- 3. message_reactions — (messageId, userId, emoji) triples; PK enforces
-- "one reaction per user per emoji per message" (toggle semantics).
-- ============================================================

CREATE TABLE IF NOT EXISTS "message_reactions" (
  "message_id"  uuid NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
  "user_id"     uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "emoji"       text NOT NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("message_id", "user_id", "emoji")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_reactions_message_idx"
  ON "message_reactions" ("message_id");
--> statement-breakpoint

-- ============================================================
-- 4. message_mentions — derived at post-time from the parsed body.
-- ============================================================

CREATE TABLE IF NOT EXISTS "message_mentions" (
  "message_id"         uuid NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
  "mentioned_user_id"  uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  PRIMARY KEY ("message_id", "mentioned_user_id")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_mentions_user_idx"
  ON "message_mentions" ("mentioned_user_id");
--> statement-breakpoint

-- ============================================================
-- 5. message_attachments — discriminated by `kind`:
--   * upload      — bytes in R2 (r2_key/r2_url/mime_type/file_size/w/h)
--   * asset_ref   — pointer to assets.id (asset_id)
--   * external_link — URL only (url)
-- ============================================================

CREATE TABLE IF NOT EXISTS "message_attachments" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "message_id"    uuid NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
  "kind"          text NOT NULL,
  "r2_key"        text,
  "r2_url"        text,
  "mime_type"     text,
  "file_size"     integer,
  "width"         integer,
  "height"        integer,
  "asset_id"      uuid REFERENCES "assets"("id") ON DELETE SET NULL,
  "url"           text,
  "display_name"  text,
  "position"      integer NOT NULL DEFAULT 0,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "message_attachments_kind_check"
    CHECK ("kind" IN ('upload', 'asset_ref', 'external_link'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_attachments_message_idx"
  ON "message_attachments" ("message_id", "position");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_attachments_asset_idx"
  ON "message_attachments" ("asset_id")
  WHERE "asset_id" IS NOT NULL;
--> statement-breakpoint

-- ============================================================
-- 6. notifications.type — `text` column with no DB-level CHECK (the enum is
-- enforced at the drizzle/TS layer; see migration 0015). Extending the
-- accepted set is therefore a schema.ts-only change (T005) and requires no
-- ALTER TABLE here. Documented for the next reader.
-- ============================================================

-- (intentionally no DDL for the notifications.type extension; see schema.ts)
