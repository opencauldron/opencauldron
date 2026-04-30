-- Migration 0016 — Library / Unified DAM foundation (Phase 2 of specs/library-dam).
--
-- Unifies `references` (uploads) and `assets` (generations) into a single
-- `assets` table with a `source` discriminator, fileName/usageCount carry-over,
-- pgvector embedding column, generated tsvector for full-text search, and a
-- one-shot rename of brands.anchor_reference_ids → brands.anchor_asset_ids.
--
-- Phase 2 is *additive only* — no existing column is dropped, no table is
-- removed. The references → assets backfill runs in a separate idempotent
-- script (`scripts/migrate-references-to-assets.ts`). The `references` table
-- and the temporary `assets.legacy_reference_id` column drop later, in a
-- separate migration after the compat-shim release lands (Phase 6 / T043).
--
-- Idempotency: every column/index uses IF NOT EXISTS; the brand-anchor
-- rename and the source-vocabulary update are guarded by information_schema
-- lookups so re-running the migration is a no-op.
--
-- Design notes for searchVector (T008):
--   * We pick option (a) — denormalized `tags_text` column maintained by
--     triggers on `asset_tags`. The generated tsvector reads from
--     `coalesce(file_name,'') || ' ' || coalesce(prompt,'') || ' ' || coalesce(tags_text,'')`.
--   * Option (b) — refresh `search_vector` directly from a trigger on
--     `asset_tags` — would require the trigger to emit the same expression
--     the generated column would have used. By denormalizing the tag string
--     into its own column, the search_vector definition stays declarative
--     and the trigger only has one job (rebuild `tags_text`).
--   * Tradeoff: an extra `text` column on `assets`. Cost is negligible; the
--     payoff is one source of truth for the FTS expression.

-- 1. pgvector extension. Phase 1 (T001) verified the extension is available
--    on Neon project `fancy-dew-30879013` (default version 0.8.0). HNSW index
--    support was added in pgvector 0.5.0, so 0.8.0 covers us.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint

-- 2. Additive columns on `assets`. `source` is intentionally NOT in this list
--    — Phase 1 found it already exists as a NOT NULL text column populated
--    with the literal "generation" for every row. We update its vocabulary
--    in step 8 below instead of re-adding the column.
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "file_name" text;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "usage_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "embedding" vector(768);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "embedding_model" text;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "embedded_at" timestamptz;
--> statement-breakpoint

-- 3. Temp pointer back to the legacy `references.id` so the backfill is
--    idempotent (re-runs skip rows where this is already set) and Phase 6
--    can audit the mapping before the references table drops.
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "legacy_reference_id" uuid;
--> statement-breakpoint

-- 4. Denormalized tag-name column feeding the generated search_vector.
--    Maintained by triggers on `asset_tags` declared further down.
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "tags_text" text NOT NULL DEFAULT '';
--> statement-breakpoint

-- 5. Generated tsvector column. Postgres requires the GENERATED ALWAYS AS
--    expression to be IMMUTABLE; coalesce + concat over text columns is fine.
--    The english config matches what the search query will use (see plan.md
--    "search query path"). Wrap in a DO block so re-runs don't trip on the
--    "column already exists" error from ADD COLUMN (since the generated-column
--    syntax doesn't support IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'assets'
       AND column_name = 'search_vector'
  ) THEN
    ALTER TABLE "assets"
      ADD COLUMN "search_vector" tsvector
      GENERATED ALWAYS AS (
        to_tsvector(
          'english',
          coalesce("file_name", '') || ' ' ||
          coalesce("prompt", '') || ' ' ||
          coalesce("tags_text", '')
        )
      ) STORED;
  END IF;
END $$;
--> statement-breakpoint

-- 6. Source-vocabulary rewrite. The live DB has every row at "generation";
--    the new vocabulary is "uploaded" | "generated" | "imported". Idempotent.
UPDATE "assets" SET "source" = 'generated' WHERE "source" = 'generation';
--> statement-breakpoint
-- A few legacy code paths wrote "upload" / "fork" before deploy; remap them
-- so the post-migration enum invariant holds. Forks are derivative
-- generations — they keep `parent_asset_id` but their source becomes
-- "generated". (No production rows match these per Phase 1 findings; this is
-- defense-in-depth.)
UPDATE "assets" SET "source" = 'uploaded' WHERE "source" = 'upload';
--> statement-breakpoint
UPDATE "assets" SET "source" = 'generated' WHERE "source" = 'fork';
--> statement-breakpoint
-- Update the column default so future raw-SQL inserts (e.g. drizzle-kit
-- push, manual seed scripts) also land on the new vocabulary. Drizzle ORM
-- inserts already pass an explicit source so this is defense-in-depth.
ALTER TABLE "assets" ALTER COLUMN "source" SET DEFAULT 'generated';
--> statement-breakpoint

-- 7. Brand-anchor column rename: anchor_reference_ids → anchor_asset_ids.
--    Wrap in a DO block so re-running this migration after the rename is a
--    no-op (PG's RENAME COLUMN doesn't have an IF EXISTS form).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'brands'
       AND column_name = 'anchor_reference_ids'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'brands'
       AND column_name = 'anchor_asset_ids'
  ) THEN
    ALTER TABLE "brands" RENAME COLUMN "anchor_reference_ids" TO "anchor_asset_ids";
  END IF;
END $$;
--> statement-breakpoint

-- 8. Indexes. Hot paths from plan.md: per-user-feed, brand filter, source
--    filter, FTS, semantic search.
CREATE INDEX IF NOT EXISTS "assets_user_id_created_at_idx"
  ON "assets" ("user_id", "created_at" DESC);
--> statement-breakpoint
-- assets_brand_id_idx exists today (created in 0008/0009); IF NOT EXISTS is
-- a no-op there but keeps the migration idempotent if someone replays it
-- against a fresh DB that never went through the older migrations.
CREATE INDEX IF NOT EXISTS "assets_brand_id_idx"
  ON "assets" ("brand_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_source_idx"
  ON "assets" ("source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_search_vector_idx"
  ON "assets" USING gin ("search_vector");
--> statement-breakpoint
-- HNSW on embedding with cosine ops. m=16 / ef_construction=64 per plan.md.
-- pgvector 0.8.0 supports HNSW directly. The IF NOT EXISTS guard keeps the
-- migration idempotent; CREATE INDEX with HNSW is non-trivial and we don't
-- want a re-run to spin it back up.
CREATE INDEX IF NOT EXISTS "assets_embedding_hnsw_idx"
  ON "assets" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
--> statement-breakpoint
-- Idempotency for the backfill — the script bails on rows whose
-- legacy_reference_id is already populated.
CREATE UNIQUE INDEX IF NOT EXISTS "assets_legacy_reference_id_uniq"
  ON "assets" ("legacy_reference_id")
  WHERE "legacy_reference_id" IS NOT NULL;
--> statement-breakpoint

-- 9. Trigger function + triggers maintaining `assets.tags_text`. Three
--    trigger paths cover every M2M edit:
--    * INSERT on asset_tags          → recompute for NEW.asset_id
--    * DELETE on asset_tags          → recompute for OLD.asset_id
--    * UPDATE on asset_tags          → recompute for both NEW and OLD asset_id
--      (in practice asset_tags rows are never updated since both columns are
--       part of the PK, but cover the case for completeness).
CREATE OR REPLACE FUNCTION "assets_refresh_tags_text"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  _asset_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _asset_id := OLD.asset_id;
  ELSE
    _asset_id := NEW.asset_id;
  END IF;

  UPDATE "assets"
     SET "tags_text" = COALESCE((
       SELECT string_agg(at.tag, ' ' ORDER BY at.tag)
         FROM "asset_tags" at
        WHERE at.asset_id = _asset_id
     ), '')
   WHERE "id" = _asset_id;

  -- For UPDATE-of-asset_id (rare; both PK cols), refresh the OLD asset too.
  IF TG_OP = 'UPDATE' AND OLD.asset_id IS DISTINCT FROM NEW.asset_id THEN
    UPDATE "assets"
       SET "tags_text" = COALESCE((
         SELECT string_agg(at.tag, ' ' ORDER BY at.tag)
           FROM "asset_tags" at
          WHERE at.asset_id = OLD.asset_id
       ), '')
     WHERE "id" = OLD.asset_id;
  END IF;

  RETURN NULL;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "asset_tags_refresh_tags_text_ins" ON "asset_tags";
--> statement-breakpoint
CREATE TRIGGER "asset_tags_refresh_tags_text_ins"
  AFTER INSERT ON "asset_tags"
  FOR EACH ROW EXECUTE FUNCTION "assets_refresh_tags_text"();
--> statement-breakpoint

DROP TRIGGER IF EXISTS "asset_tags_refresh_tags_text_del" ON "asset_tags";
--> statement-breakpoint
CREATE TRIGGER "asset_tags_refresh_tags_text_del"
  AFTER DELETE ON "asset_tags"
  FOR EACH ROW EXECUTE FUNCTION "assets_refresh_tags_text"();
--> statement-breakpoint

DROP TRIGGER IF EXISTS "asset_tags_refresh_tags_text_upd" ON "asset_tags";
--> statement-breakpoint
CREATE TRIGGER "asset_tags_refresh_tags_text_upd"
  AFTER UPDATE ON "asset_tags"
  FOR EACH ROW EXECUTE FUNCTION "assets_refresh_tags_text"();
--> statement-breakpoint

-- 10. One-shot backfill of tags_text for any existing assets that already
--     have tag rows (so the generated search_vector is correct from migration
--     time, not just for future tag edits). Idempotent: rewrites the same
--     value the trigger would compute.
UPDATE "assets" a
   SET "tags_text" = COALESCE(sub.tags_text, '')
  FROM (
    SELECT asset_id, string_agg(tag, ' ' ORDER BY tag) AS tags_text
      FROM "asset_tags"
     GROUP BY asset_id
  ) sub
 WHERE a.id = sub.asset_id
   AND a."tags_text" IS DISTINCT FROM COALESCE(sub.tags_text, '');
