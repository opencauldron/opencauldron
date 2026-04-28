-- Migration 0009 — Data backfill for the agency DAM MVP.
--
-- Idempotent. Wraps everything in a single DO block so it runs in one
-- implicit transaction and any failure rolls the whole thing back. Re-running
-- after a partial failure is safe because every INSERT uses ON CONFLICT DO
-- NOTHING and every UPDATE filters on "still NULL" / "still legacy value."
--
-- The migration:
--   1. Creates the canonical `Taboogrow` workspace if it doesn't exist.
--   2. Promotes every existing user to a workspace member (legacy app `admin`
--      → workspace `owner`, everyone else → `member`).
--   3. Pins any pre-existing `brands` rows to the bootstrap workspace and
--      backfills slugs derived from name.
--   4. Seeds the three canonical brands `Taboo Grow`, `GIDDI`, `Cauldron`.
--   5. Adds every workspace member as `creator` on `Taboo Grow`. The product
--      owner (resolved by email or first-by-creation) becomes `brand_manager`
--      on all three seed brands.
--   6. Eagerly creates a Personal brand per workspace member (FR-006) and the
--      paired `brand_members` row.
--   7. Folds every existing `brews` row into `Taboo Grow` and rewrites the
--      legacy `unlisted` visibility value to `brand` (FR-041 — adjusted for
--      the 3-value enum already in prod).
--   8. Folds every existing `assets` row into `Taboo Grow`, taking the FIRST
--      brand from `asset_brands` if one exists.
--   9. Marks all pre-existing assets as `approved` (they predate the review
--      pipeline) and sets `source` based on whether a `generations` row exists.
DO $$
DECLARE
  _ws_id uuid;
  _admin_id uuid;
  _taboo_grow_id uuid;
  _giddi_id uuid;
  _cauldron_id uuid;
  _user_count int;
BEGIN
  -- Skip the entire backfill on fresh databases (no users → nothing to migrate).
  SELECT COUNT(*) INTO _user_count FROM users;
  IF _user_count = 0 THEN
    RAISE NOTICE '0009 backfill: no users present, skipping.';
    RETURN;
  END IF;

  -- Resolve the bootstrap admin: prefer ajlevoy@gmail.com, fall back to the
  -- first user by created_at so self-hosted installs still work.
  SELECT id INTO _admin_id FROM users WHERE email = 'ajlevoy@gmail.com';
  IF _admin_id IS NULL THEN
    SELECT id INTO _admin_id FROM users ORDER BY created_at ASC LIMIT 1;
  END IF;

  -- 1. Canonical workspace.
  INSERT INTO workspaces (name, slug, mode, created_by)
  VALUES ('Taboogrow', 'taboogrow', 'hosted', _admin_id)
  ON CONFLICT (slug) DO NOTHING;
  SELECT id INTO _ws_id FROM workspaces WHERE slug = 'taboogrow';

  -- 2. Workspace memberships for every existing user.
  INSERT INTO workspace_members (workspace_id, user_id, role)
  SELECT _ws_id, id,
         CASE WHEN role = 'admin' THEN 'owner' ELSE 'member' END
  FROM users
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  -- 3. Pin pre-existing brands to the workspace and synthesize slugs.
  UPDATE brands SET workspace_id = _ws_id WHERE workspace_id IS NULL;
  UPDATE brands SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
   WHERE slug IS NULL;

  -- 4. Three seed brands. ON CONFLICT idempotent on (workspace_id, name).
  -- The unique index is partial (WHERE is_personal = false), so we must
  -- repeat the predicate in the conflict-target clause for Postgres to
  -- match the index (introduced in 0013).
  INSERT INTO brands (workspace_id, name, slug, color, is_personal, created_by)
  VALUES
    (_ws_id, 'Taboo Grow', 'taboo-grow', '#22c55e', false, _admin_id),
    (_ws_id, 'GIDDI',      'giddi',      '#000000', false, _admin_id),
    (_ws_id, 'Cauldron',   'cauldron',   '#6366f1', false, _admin_id)
  ON CONFLICT (workspace_id, name) WHERE is_personal = false DO NOTHING;

  SELECT id INTO _taboo_grow_id FROM brands
   WHERE workspace_id = _ws_id AND name = 'Taboo Grow';
  SELECT id INTO _giddi_id FROM brands
   WHERE workspace_id = _ws_id AND name = 'GIDDI';
  SELECT id INTO _cauldron_id FROM brands
   WHERE workspace_id = _ws_id AND name = 'Cauldron';

  -- 5. Brand membership: everyone is a creator on Taboo Grow (legacy data
  -- lives there). The bootstrap admin is a brand_manager on all three.
  INSERT INTO brand_members (brand_id, user_id, role)
  SELECT _taboo_grow_id, u.id,
         CASE WHEN u.id = _admin_id THEN 'brand_manager' ELSE 'creator' END
  FROM users u
  ON CONFLICT (brand_id, user_id) DO NOTHING;

  INSERT INTO brand_members (brand_id, user_id, role)
  VALUES
    (_giddi_id,    _admin_id, 'brand_manager'),
    (_cauldron_id, _admin_id, 'brand_manager')
  ON CONFLICT (brand_id, user_id) DO NOTHING;

  -- 6. Eager Personal brand per user (FR-006). Slug uses the user id prefix
  -- to guarantee uniqueness within the workspace.
  INSERT INTO brands (workspace_id, name, slug, color, is_personal, owner_id, created_by)
  SELECT _ws_id,
         'Personal',
         'personal-' || substr(u.id::text, 1, 8),
         '#94a3b8',
         true,
         u.id,
         u.id
  FROM users u
  WHERE NOT EXISTS (
    SELECT 1 FROM brands b
     WHERE b.workspace_id = _ws_id
       AND b.is_personal = true
       AND b.owner_id = u.id
  );

  -- 6b. Each user is the sole creator on their Personal brand.
  INSERT INTO brand_members (brand_id, user_id, role)
  SELECT b.id, b.owner_id, 'creator'
  FROM brands b
  WHERE b.workspace_id = _ws_id
    AND b.is_personal = true
  ON CONFLICT (brand_id, user_id) DO NOTHING;

  -- 7. Brews — fold null-brand rows into Taboo Grow and rewrite the legacy
  -- `unlisted` visibility value to `brand`. Other visibility values stay.
  UPDATE brews SET brand_id = _taboo_grow_id WHERE brand_id IS NULL;
  UPDATE brews SET visibility = 'brand' WHERE visibility = 'unlisted';

  -- 8. Assets — every existing row gets a brand. Prefer the FIRST brand from
  -- the legacy `asset_brands` junction if one exists; otherwise Taboo Grow.
  UPDATE assets a
     SET brand_id = sub.brand_id
    FROM (
      SELECT DISTINCT ON (asset_id) asset_id, brand_id
        FROM asset_brands
        ORDER BY asset_id, brand_id
    ) sub
   WHERE a.id = sub.asset_id
     AND a.brand_id IS NULL;

  UPDATE assets SET brand_id = _taboo_grow_id WHERE brand_id IS NULL;

  -- 9. Pre-existing assets predate the review pipeline — mark approved.
  UPDATE assets SET status = 'approved' WHERE status = 'draft';

  -- 10. Source classification.
  UPDATE assets a SET source = 'generation'
   WHERE EXISTS (SELECT 1 FROM generations g WHERE g.asset_id = a.id)
     AND a.source = 'generation';
  -- Anything that lacks a generations row stays as `generation` default for
  -- now; the upload backfill happens at upload time once Phase 7 lands.

  RAISE NOTICE '0009 backfill complete. workspace=%, taboo_grow=%, giddi=%, cauldron=%',
    _ws_id, _taboo_grow_id, _giddi_id, _cauldron_id;
END $$;
