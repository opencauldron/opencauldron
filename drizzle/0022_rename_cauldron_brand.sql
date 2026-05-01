-- Migration 0022 — Rebrand the seed `Cauldron` brand to `OpenCauldron`.
--
-- Idempotent and additive: only renames rows that still hold the legacy
-- name+slug pair. Brand UUID is preserved, so every linked row (assets,
-- brews, brand_members, etc.) keeps working without touching foreign keys.
--
-- Safe to run on:
--   - Fresh DBs (no rows match → no-op)
--   - DBs already on the new name (no rows match → no-op)
--   - DBs where someone manually created an unrelated `OpenCauldron` brand
--     in the same workspace (NOT EXISTS guard prevents the unique-index
--     conflict from the partial index on (workspace_id, name)).
UPDATE brands
   SET name = 'OpenCauldron',
       slug = 'opencauldron'
 WHERE name = 'Cauldron'
   AND slug = 'cauldron'
   AND is_personal = false
   AND NOT EXISTS (
     SELECT 1 FROM brands b2
      WHERE b2.workspace_id = brands.workspace_id
        AND b2.name = 'OpenCauldron'
        AND b2.is_personal = false
   );
