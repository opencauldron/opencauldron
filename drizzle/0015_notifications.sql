-- Migration 0015 — Notifications table.
--
-- Backs the in-app bell feed. One row per delivered notification, scoped to
-- a (user, workspace) pair so a user with multi-workspace memberships sees
-- only the active workspace's feed.
--
-- Indexes:
--   * (user_id, workspace_id, created_at) — feed page query.
--   * (user_id, read_at)                  — unread-count badge.
--
-- FKs:
--   * user_id, workspace_id  ON DELETE CASCADE — no orphan rows.
--   * actor_id               ON DELETE SET NULL — keep history when an
--     actor leaves the workspace.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "actor_id" uuid,
  "type" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "href" text,
  "read_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "notifications_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "notifications_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "notifications_actor_id_users_id_fk"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notifications_user_workspace_created_idx"
  ON "notifications" USING btree ("user_id","workspace_id","created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notifications_user_unread_idx"
  ON "notifications" USING btree ("user_id","read_at");
