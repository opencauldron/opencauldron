-- Migration 0017 — Normalize search_vector tokens (Phase 4 / FTS bugfix).
--
-- 0016 declared `search_vector` as
--     to_tsvector('english',
--       coalesce(file_name,'') || ' ' || coalesce(prompt,'') || ' ' || coalesce(tags_text,''))
-- which works for prompt text but breaks on filenames and tag names that
-- contain hyphens / underscores / dots. Postgres's default text-search parser
-- recognises strings like `hero-shot-001.png` as a *single* "host" token, so
-- `websearch_to_tsquery('english', 'hero')` doesn't match the asset.
--
-- Fix: normalise file_name and tags_text by replacing `[-_./]+` with spaces
-- BEFORE tokenisation, so `hero-shot-001.png` becomes the lexemes
-- `hero, shot, 001, png` (each individually queryable). `prompt` is left
-- untouched — it's free-form English where punctuation matters for stemming.
--
-- A generated column's expression can't be altered in place; we drop + recreate
-- around the GIN index that depends on it. Both column and index are recreated
-- with identical names so the rest of the schema (T025 query handler, the
-- detection that drives `<FilterBar>` empty states) keeps working unchanged.
--
-- Idempotency: every step uses IF EXISTS / IF NOT EXISTS or a DO block that
-- only mutates when the current state requires it.

-- 1. Drop the GIN index. Generated columns can't be dropped while an index
--    references them.
DROP INDEX IF EXISTS "assets_search_vector_idx";
--> statement-breakpoint

-- 2. Drop the generated column. We're rebuilding it.
ALTER TABLE "assets" DROP COLUMN IF EXISTS "search_vector";
--> statement-breakpoint

-- 3. Recreate the generated column with the normalised expression.
ALTER TABLE "assets"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'english',
      coalesce(regexp_replace("file_name", '[-_./]+', ' ', 'g'), '') || ' ' ||
      coalesce("prompt", '') || ' ' ||
      coalesce(regexp_replace("tags_text", '[-_./]+', ' ', 'g'), '')
    )
  ) STORED;
--> statement-breakpoint

-- 4. Recreate the GIN index over the new column.
CREATE INDEX IF NOT EXISTS "assets_search_vector_idx"
  ON "assets" USING gin ("search_vector");
