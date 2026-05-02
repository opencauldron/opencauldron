/**
 * Activity feed read-side helpers — tab queries + hydration.
 *
 * Boundary: pure DB helpers. No auth, no session lookups — callers pass user
 * + workspace IDs directly. The route layer enforces auth + workspace
 * scoping (NFR-004); this module assumes the IDs it gets are already
 * trusted.
 *
 * Tabs (US1 acceptance criteria + plan T041):
 *   - for-you   — events I'm an actor in, OR workspace-scoped events in my
 *                 workspace, OR events on assets I created.
 *   - my-brands — visibility = 'brand' AND brand_id IN (my brand
 *                 memberships in this workspace). Per plan assumption,
 *                 we exclude the user's own personal brand from this set.
 *   - workspace — visibility = 'workspace' AND workspace_id = me.
 *
 * Cursor pagination is on `(created_at desc, id desc)` matching the
 * indexes from migration 0023. The cursor is opaque base64 of the
 * trailing row's ISO timestamp + UUID.
 *
 * Hydration (T043) fans out by `object_type` in one round-trip per type,
 * then zips the results back into the event list. Object types in v1:
 *   - asset       → assets table (thumbnail, prompt, brand)
 *   - user        → users table (level-up actor profile)
 *   - feat        → badges table (feat name + icon)
 *   - generation  → generations table → its asset (effectively asset hydration)
 */

// NOTE: no `server-only` import — `src/lib/notifications.ts` (the closest
// peer module — auth-bound DB reads consumed by route handlers and pages)
// also doesn't use it, and the package isn't a project dep. The route layer
// (`src/app/api/activity/route.ts`) is the trust boundary; this module is
// pure DB helpers and MUST NOT be imported from a client component (it
// pulls in `pg` transitively which the browser bundler can't resolve).
// Client modules import the pure types from `activity-feed-types.ts`.
import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activityEvents,
  assets,
  badges,
  brandMembers,
  brands,
  users,
} from "@/lib/db/schema";
import type { ActivityVerb, ActivityVisibility } from "@/lib/activity";
// Local imports limited to types that are referenced by name inside this
// file. Other types from the types module are surfaced to consumers via the
// `export type` block below (re-export — no local reference needed).
import type {
  ActivityCursor,
  HydratedActivityEvent,
  HydratedObject,
} from "@/lib/activity-feed-types";

// Re-export types + constants for ergonomic single-import on the server.
export {
  ACTIVITY_LIMIT_DEFAULT,
  ACTIVITY_LIMIT_MAX,
  ACTIVITY_TAB_VALUES,
  ACTIVITY_CHIP_VALUES,
  ACTIVITY_CHIP_LABELS,
  ACTIVITY_SINCE_VALUES,
  ACTIVITY_SINCE_LABELS,
  resolveChipsToVerbs,
  resolveSince,
} from "@/lib/activity-feed-types";
export type {
  ActivityCursor,
  ActivityTab,
  ActivityChip,
  ActivitySince,
  HydratedActivityEvent,
  HydratedActor,
  HydratedBrand,
  HydratedObject,
} from "@/lib/activity-feed-types";
export type { ActivityVerb } from "@/lib/activity";

/** Raw DB shape (post-cursor decode, pre-hydration). */
export interface RawActivityRow {
  id: string;
  createdAt: Date;
  actorId: string;
  verb: ActivityVerb;
  objectType: string;
  objectId: string;
  workspaceId: string;
  brandId: string | null;
  visibility: ActivityVisibility;
  metadata: Record<string, unknown>;
}

export function encodeActivityCursor(c: ActivityCursor): string {
  return Buffer.from(`${c.createdAt}|${c.id}`, "utf8").toString("base64url");
}

export function decodeActivityCursor(token: string): ActivityCursor | null {
  try {
    const text = Buffer.from(token, "base64url").toString("utf8");
    const [createdAt, id] = text.split("|");
    if (!createdAt || !id) return null;
    if (Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tab queries (T041)
// ---------------------------------------------------------------------------

interface TabQueryArgs {
  userId: string;
  workspaceId: string;
  cursor: ActivityCursor | null;
  limit: number;
  /**
   * US6 / Phase 8 — verb filter. Empty array = no filter (caller passes
   * the result of `resolveChipsToVerbs()`; that fn already returns `[]`
   * when no chips are selected). Non-empty array → `WHERE verb = ANY(...)`.
   */
  verbs?: readonly ActivityVerb[];
  /** US6 / Phase 8 — `WHERE created_at >= since`. Null = no lower bound. */
  since?: Date | null;
}

/**
 * Cursor predicate — `(createdAt, id) < (cursorCreatedAt, cursorId)` ordered
 * desc-desc. Implemented as the lexicographic SQL idiom so it can ride the
 * `(workspace_id, created_at desc)` index without a sort.
 */
function cursorPredicate(cursor: ActivityCursor | null) {
  if (!cursor) return undefined;
  return or(
    lt(activityEvents.createdAt, new Date(cursor.createdAt)),
    and(
      eq(activityEvents.createdAt, new Date(cursor.createdAt)),
      lt(activityEvents.id, cursor.id)
    )
  );
}

/**
 * US6 — verb filter predicate. Returns `undefined` for "no filter" so
 * `and(...)` skips it entirely (no-op). Postgres-side resolves to
 * `WHERE verb = ANY($1::text[])` which the planner handles cleanly on the
 * existing `(workspace_id, created_at desc)` index — verified via EXPLAIN
 * (see Setup notes T091).
 */
function verbsPredicate(verbs: readonly ActivityVerb[] | undefined) {
  if (!verbs || verbs.length === 0) return undefined;
  return inArray(activityEvents.verb, verbs as ActivityVerb[]);
}

/** US6 — `created_at >= since` predicate, or no-op when since is null. */
function sincePredicate(since: Date | null | undefined) {
  if (!since) return undefined;
  return gte(activityEvents.createdAt, since);
}

/**
 * "For you" — the union of:
 *   1. events I'm the actor on (any visibility, scoped to my workspace),
 *   2. workspace-scoped events in my workspace,
 *   3. brand events on assets I created (regardless of brand membership).
 *
 * Implementation: a single SELECT with a compound WHERE plus an `EXISTS`
 * subquery for case (3). All three legs are pre-filtered by `workspace_id =
 * me` so cross-workspace bleed is impossible (FR-009).
 *
 * NOTE on private events: a private event is, by construction, only visible
 * to its actor. Case (1) covers that — no separate clause needed.
 */
export async function loadForYouTab(
  args: TabQueryArgs
): Promise<RawActivityRow[]> {
  const { userId, workspaceId, cursor, limit, verbs, since } = args;

  const ownAssetExists = sql`EXISTS (
    SELECT 1 FROM ${assets}
    WHERE ${assets.id}::text = ${activityEvents.objectId}
      AND ${assets.userId} = ${userId}
  )`;

  const where = and(
    eq(activityEvents.workspaceId, workspaceId),
    or(
      eq(activityEvents.actorId, userId),
      eq(activityEvents.visibility, "workspace"),
      and(
        eq(activityEvents.objectType, "asset"),
        ownAssetExists as ReturnType<typeof eq>
      )
    ),
    verbsPredicate(verbs),
    sincePredicate(since),
    cursorPredicate(cursor)
  );

  const rows = await db
    .select({
      id: activityEvents.id,
      createdAt: activityEvents.createdAt,
      actorId: activityEvents.actorId,
      verb: activityEvents.verb,
      objectType: activityEvents.objectType,
      objectId: activityEvents.objectId,
      workspaceId: activityEvents.workspaceId,
      brandId: activityEvents.brandId,
      visibility: activityEvents.visibility,
      metadata: activityEvents.metadata,
    })
    .from(activityEvents)
    .where(where)
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
    .limit(limit);

  return rows.map(normalizeRow);
}

/**
 * "My brands" — events with `visibility = 'brand'` on brands the user is a
 * member of in the active workspace. Per plan assumption, we exclude the
 * user's own personal brand (those events surface in For-you).
 *
 * If the user has zero brand memberships → return empty without a SQL hit.
 */
export async function loadMyBrandsTab(
  args: TabQueryArgs
): Promise<RawActivityRow[]> {
  const { userId, workspaceId, cursor, limit, verbs, since } = args;

  // Brand memberships in THIS workspace, excluding personal brands the user
  // owns (they surface in For-you, not here — plan assumption).
  const brandIds = (
    await db
      .select({ id: brandMembers.brandId })
      .from(brandMembers)
      .innerJoin(brands, eq(brands.id, brandMembers.brandId))
      .where(
        and(
          eq(brandMembers.userId, userId),
          eq(brands.workspaceId, workspaceId),
          eq(brands.isPersonal, false)
        )
      )
  ).map((r) => r.id);

  if (brandIds.length === 0) return [];

  const where = and(
    eq(activityEvents.workspaceId, workspaceId),
    eq(activityEvents.visibility, "brand"),
    inArray(activityEvents.brandId, brandIds),
    verbsPredicate(verbs),
    sincePredicate(since),
    cursorPredicate(cursor)
  );

  const rows = await db
    .select({
      id: activityEvents.id,
      createdAt: activityEvents.createdAt,
      actorId: activityEvents.actorId,
      verb: activityEvents.verb,
      objectType: activityEvents.objectType,
      objectId: activityEvents.objectId,
      workspaceId: activityEvents.workspaceId,
      brandId: activityEvents.brandId,
      visibility: activityEvents.visibility,
      metadata: activityEvents.metadata,
    })
    .from(activityEvents)
    .where(where)
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
    .limit(limit);

  return rows.map(normalizeRow);
}

/**
 * "Workspace" — events with `visibility = 'workspace'` in the active
 * workspace. Anyone in the workspace can see these.
 */
export async function loadWorkspaceTab(
  args: TabQueryArgs
): Promise<RawActivityRow[]> {
  const { workspaceId, cursor, limit, verbs, since } = args;

  const where = and(
    eq(activityEvents.workspaceId, workspaceId),
    eq(activityEvents.visibility, "workspace"),
    verbsPredicate(verbs),
    sincePredicate(since),
    cursorPredicate(cursor)
  );

  const rows = await db
    .select({
      id: activityEvents.id,
      createdAt: activityEvents.createdAt,
      actorId: activityEvents.actorId,
      verb: activityEvents.verb,
      objectType: activityEvents.objectType,
      objectId: activityEvents.objectId,
      workspaceId: activityEvents.workspaceId,
      brandId: activityEvents.brandId,
      visibility: activityEvents.visibility,
      metadata: activityEvents.metadata,
    })
    .from(activityEvents)
    .where(where)
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
    .limit(limit);

  return rows.map(normalizeRow);
}

// ---------------------------------------------------------------------------
// Recent rail (T060) — union of all three tab visibilities the user can see,
// in a single indexed scan. Used by the dashboard "Recent activity" rail.
// Distinct from the tab queries because the rail wants a *mixed* feed —
// anything the user is entitled to, capped at a small N.
// ---------------------------------------------------------------------------

// Default 6 (Designer review): 10 rows at ~440px dominates the dashboard
// next to the ~280px peer widget tiles. Spec FR allows 5–10. Caller can
// pass a higher limit explicitly; clamped at MAX = 25.
export const ACTIVITY_RECENT_LIMIT_DEFAULT = 6;
export const ACTIVITY_RECENT_LIMIT_MAX = 25;

interface RecentQueryArgs {
  userId: string;
  workspaceId: string;
  limit: number;
  /** US6 — same semantics as the tab queries; omit / empty = no filter. */
  verbs?: readonly ActivityVerb[];
  /** US6 — `created_at >= since`, or null for no lower bound. */
  since?: Date | null;
}

/**
 * Mixed recent activity — union of:
 *   - workspace-visibility events in this workspace, AND
 *   - private events where I'm the actor, AND
 *   - brand events on brands I'm a non-personal member of.
 *
 * Implemented as a single SELECT with a compound OR + a sub-select for the
 * brand-member set so the planner can ride the
 * `(workspace_id, created_at desc)` index. We considered three separate
 * queries unioned in JS but the OR variant beats it in practice because
 * the workspace_id pre-filter knocks the candidate set down before the
 * visibility branches kick in.
 *
 * If the user has zero managed-brand memberships we omit the brand leg
 * entirely — the OR shrinks to two cheap predicates and the planner
 * can short-circuit.
 *
 * Ordered desc; capped at `limit` (default 10, max 25 — the rail surface
 * never wants more than that).
 */
export async function loadRecentActivity(
  args: RecentQueryArgs
): Promise<RawActivityRow[]> {
  const { userId, workspaceId, limit, verbs, since } = args;

  // Brand memberships in THIS workspace, excluding personal brands the
  // user owns (those events surface via the `actor_id = me` private leg
  // already; counting them here would double-include them in the rail).
  const brandIds = (
    await db
      .select({ id: brandMembers.brandId })
      .from(brandMembers)
      .innerJoin(brands, eq(brands.id, brandMembers.brandId))
      .where(
        and(
          eq(brandMembers.userId, userId),
          eq(brands.workspaceId, workspaceId),
          eq(brands.isPersonal, false)
        )
      )
  ).map((r) => r.id);

  // Events on assets I created — same EXISTS subquery as `loadForYouTab`.
  // Without this leg, an approval / submission someone else does on MY
  // asset (in a brand I'm not a member of) would surface in `/activity`'s
  // For-you tab but NOT on the dashboard rail. The rail must be a
  // superset of what the user could discover by clicking into /activity.
  const ownAssetExists = sql`EXISTS (
    SELECT 1 FROM ${assets}
    WHERE ${assets.id}::text = ${activityEvents.objectId}
      AND ${assets.userId} = ${userId}
  )`;

  const visibilityClauses = [
    eq(activityEvents.visibility, "workspace"),
    and(
      eq(activityEvents.visibility, "private"),
      eq(activityEvents.actorId, userId)
    ),
    // Brand events the user is a member of. When `brandIds` is empty we
    // skip the leg entirely (inArray with [] would always be false anyway,
    // but skipping is cheaper to plan).
    ...(brandIds.length > 0
      ? [
          and(
            eq(activityEvents.visibility, "brand"),
            inArray(activityEvents.brandId, brandIds)
          ),
        ]
      : []),
    // Brand events on MY assets even when I'm not in that brand.
    and(
      eq(activityEvents.objectType, "asset"),
      ownAssetExists as ReturnType<typeof eq>
    ),
  ];

  const where = and(
    eq(activityEvents.workspaceId, workspaceId),
    or(...visibilityClauses),
    verbsPredicate(verbs),
    sincePredicate(since)
  );

  const rows = await db
    .select({
      id: activityEvents.id,
      createdAt: activityEvents.createdAt,
      actorId: activityEvents.actorId,
      verb: activityEvents.verb,
      objectType: activityEvents.objectType,
      objectId: activityEvents.objectId,
      workspaceId: activityEvents.workspaceId,
      brandId: activityEvents.brandId,
      visibility: activityEvents.visibility,
      metadata: activityEvents.metadata,
    })
    .from(activityEvents)
    .where(where)
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
    .limit(limit);

  return rows.map(normalizeRow);
}

function normalizeRow(r: {
  id: string;
  createdAt: Date;
  actorId: string;
  verb: string;
  objectType: string;
  objectId: string;
  workspaceId: string;
  brandId: string | null;
  visibility: string;
  metadata: Record<string, unknown> | unknown;
}): RawActivityRow {
  return {
    id: r.id,
    createdAt: r.createdAt,
    actorId: r.actorId,
    verb: r.verb as ActivityVerb,
    objectType: r.objectType,
    objectId: r.objectId,
    workspaceId: r.workspaceId,
    brandId: r.brandId,
    visibility: r.visibility as ActivityVisibility,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  };
}

// ---------------------------------------------------------------------------
// Hydration (T043)
// ---------------------------------------------------------------------------

/**
 * Hydrate raw events with their related objects (actors, brands, assets,
 * feats, generations). One round-trip per object_type — never N+1.
 *
 * `getThumbnailUrl` is injected so hydration stays pure-DB (no R2 import in
 * tests). Pass `null` to skip thumbnail resolution and emit raw r2 keys
 * (used by tests + the recent-rail when storage isn't reachable).
 */
export interface HydrateOptions {
  getThumbnailUrl?: (r2Key: string) => Promise<string | null>;
}

export async function hydrateActivityEvents(
  raws: RawActivityRow[],
  opts: HydrateOptions = {}
): Promise<HydratedActivityEvent[]> {
  if (raws.length === 0) return [];

  const actorIds = unique(raws.map((r) => r.actorId));
  const brandIds = unique(
    raws.map((r) => r.brandId).filter((x): x is string => x !== null)
  );

  const assetIds = unique(
    raws
      .filter((r) => r.objectType === "asset")
      .map((r) => r.objectId)
  );
  const userObjectIds = unique(
    raws
      .filter((r) => r.objectType === "user")
      .map((r) => r.objectId)
  );
  const featIds = unique(
    raws
      .filter((r) => r.objectType === "feat")
      .map((r) => r.objectId)
  );
  const generationIds = unique(
    raws
      .filter((r) => r.objectType === "generation")
      .map((r) => r.objectId)
  );

  // Note: each `inArray(... , [])` is a no-op on the SQL side; we still
  // short-circuit so we don't issue an empty query.
  const [
    actorRows,
    brandRows,
    assetRows,
    userObjectRows,
    featRows,
    generationAssetRows,
  ] = await Promise.all([
    actorIds.length
      ? db
          .select({ id: users.id, name: users.name, image: users.image })
          .from(users)
          .where(inArray(users.id, actorIds))
      : Promise.resolve([] as Array<{ id: string; name: string | null; image: string | null }>),
    brandIds.length
      ? db
          .select({
            id: brands.id,
            name: brands.name,
            slug: brands.slug,
            isPersonal: brands.isPersonal,
          })
          .from(brands)
          .where(inArray(brands.id, brandIds))
      : Promise.resolve(
          [] as Array<{ id: string; name: string; slug: string | null; isPersonal: boolean }>
        ),
    assetIds.length
      ? db
          .select({
            id: assets.id,
            prompt: assets.prompt,
            r2Key: assets.r2Key,
            thumbnailR2Key: assets.thumbnailR2Key,
            webpR2Key: assets.webpR2Key,
            mediaType: assets.mediaType,
            status: assets.status,
          })
          .from(assets)
          .where(inArray(assets.id, assetIds))
      : Promise.resolve([] as Array<{
          id: string;
          prompt: string;
          r2Key: string;
          thumbnailR2Key: string | null;
          webpR2Key: string | null;
          mediaType: "image" | "video";
          status: string;
        }>),
    userObjectIds.length
      ? db
          .select({ id: users.id, name: users.name, image: users.image })
          .from(users)
          .where(inArray(users.id, userObjectIds))
      : Promise.resolve([] as Array<{ id: string; name: string | null; image: string | null }>),
    featIds.length
      ? db
          .select({ id: badges.id, name: badges.name, icon: badges.icon })
          .from(badges)
          .where(inArray(badges.id, featIds))
      : Promise.resolve([] as Array<{ id: string; name: string; icon: string }>),
    // generations join to assets — single round-trip via leftJoin.
    generationIds.length
      ? db
          .select({
            generationId: sql<string>`${activityEvents.objectId}`.as("dummy"), // placeholder; replaced below
          })
          .from(activityEvents)
          .where(sql`false`)
          .limit(0)
      : Promise.resolve([]),
  ]);

  // Generation hydration — separate query so the type stays clean. We pull
  // the linked asset's preview if present (`assets.id = generations.asset_id`).
  const generationRows = generationIds.length
    ? await db
        .select({
          id: sql<string>`g.id::text`.as("g_id"),
          assetId: sql<string | null>`g.asset_id::text`.as("g_asset_id"),
          prompt: sql<string | null>`a.prompt`.as("g_prompt"),
          thumbnailR2Key: sql<string | null>`a.thumbnail_r2_key`.as("g_thumb"),
          r2Key: sql<string | null>`a.r2_key`.as("g_r2"),
          mediaType: sql<"image" | "video" | null>`a.media_type`.as("g_media"),
        })
        .from(sql`generations g`)
        .leftJoin(sql`assets a`, sql`a.id = g.asset_id`)
        .where(sql`g.id IN (${sql.join(generationIds.map((id) => sql`${id}::uuid`), sql`, `)})`)
    : [];

  void generationAssetRows; // discarded — replaced by `generationRows`

  const actorMap = new Map(actorRows.map((r) => [r.id, r]));
  const brandMap = new Map(brandRows.map((r) => [r.id, r]));
  const assetMap = new Map(assetRows.map((r) => [r.id, r]));
  const userMap = new Map(userObjectRows.map((r) => [r.id, r]));
  const featMap = new Map(featRows.map((r) => [r.id, r]));
  const generationMap = new Map(
    generationRows.map((r) => [r.id, r])
  );

  // Resolve thumbnail URLs in parallel for all unique r2 keys we need.
  const r2Keys = new Set<string>();
  for (const a of assetRows) {
    const key = a.thumbnailR2Key ?? a.webpR2Key ?? a.r2Key;
    if (key) r2Keys.add(key);
  }
  for (const g of generationRows) {
    const key = g.thumbnailR2Key ?? g.r2Key;
    if (key) r2Keys.add(key);
  }
  const r2UrlMap = new Map<string, string | null>();
  if (opts.getThumbnailUrl && r2Keys.size > 0) {
    await Promise.all(
      Array.from(r2Keys).map(async (key) => {
        try {
          r2UrlMap.set(key, await opts.getThumbnailUrl!(key));
        } catch {
          r2UrlMap.set(key, null);
        }
      })
    );
  }

  return raws.map((r) => {
    const actor = actorMap.get(r.actorId) ?? { id: r.actorId, name: null, image: null };
    const brand = r.brandId
      ? brandMap.get(r.brandId) ?? null
      : null;
    const object = hydrateObject(r, {
      assetMap,
      userMap,
      featMap,
      generationMap,
      r2UrlMap,
    });
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      verb: r.verb,
      visibility: r.visibility,
      brandId: r.brandId,
      actor,
      brand,
      object,
      metadata: r.metadata,
      href: detailHref(object, actor.id),
    };
  });
}

interface HydrationMaps {
  assetMap: Map<
    string,
    {
      id: string;
      prompt: string;
      r2Key: string;
      thumbnailR2Key: string | null;
      webpR2Key: string | null;
      mediaType: "image" | "video";
      status: string;
    }
  >;
  userMap: Map<string, { id: string; name: string | null; image: string | null }>;
  featMap: Map<string, { id: string; name: string; icon: string }>;
  generationMap: Map<
    string,
    {
      id: string;
      assetId: string | null;
      prompt: string | null;
      thumbnailR2Key: string | null;
      r2Key: string | null;
      mediaType: "image" | "video" | null;
    }
  >;
  r2UrlMap: Map<string, string | null>;
}

function hydrateObject(
  r: RawActivityRow,
  maps: HydrationMaps
): HydratedObject {
  switch (r.objectType) {
    case "asset": {
      const a = maps.assetMap.get(r.objectId);
      if (!a) return { type: "unknown", id: r.objectId };
      const key = a.thumbnailR2Key ?? a.webpR2Key ?? a.r2Key;
      return {
        type: "asset",
        id: a.id,
        prompt: a.prompt,
        thumbnailUrl: maps.r2UrlMap.get(key) ?? null,
        mediaType: a.mediaType,
        status: a.status,
      };
    }
    case "user": {
      const u = maps.userMap.get(r.objectId);
      if (!u) return { type: "unknown", id: r.objectId };
      return { type: "user", id: u.id, name: u.name, image: u.image };
    }
    case "feat": {
      const f = maps.featMap.get(r.objectId);
      if (!f) return { type: "unknown", id: r.objectId };
      return { type: "feat", id: f.id, name: f.name, icon: f.icon };
    }
    case "generation": {
      const g = maps.generationMap.get(r.objectId);
      if (!g) return { type: "unknown", id: r.objectId };
      const key = g.thumbnailR2Key ?? g.r2Key;
      return {
        type: "generation",
        id: g.id,
        assetId: g.assetId,
        prompt: g.prompt,
        thumbnailUrl: key ? maps.r2UrlMap.get(key) ?? null : null,
        mediaType: g.mediaType,
      };
    }
    default:
      return { type: "unknown", id: r.objectId };
  }
}

/**
 * Click-through href to the canonical detail surface (US1 acceptance
 * criterion #6 — every row navigates somewhere meaningful).
 *
 *   - asset       → /library?asset=<id>            (existing detail-panel route)
 *   - generation  → /library?asset=<assetId>       when present, else actor profile
 *   - user        → /profile/<id>                  (level-up rows, etc.)
 *   - feat        → /profile/<actorId>             (no per-feat page exists; the
 *                                                   actor's profile is the canonical
 *                                                   "who earned this" surface)
 *   - unknown     → null                           (degraded — row falls back to
 *                                                   non-clickable; rare)
 */
function detailHref(object: HydratedObject, actorId: string): string | null {
  switch (object.type) {
    case "asset":
      return `/library?asset=${object.id}`;
    case "generation":
      return object.assetId
        ? `/library?asset=${object.assetId}`
        : `/profile/${actorId}`;
    case "user":
      return `/profile/${object.id}`;
    case "feat":
      return `/profile/${actorId}`;
    case "unknown":
      return null;
  }
}

function unique<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

/**
 * Drop `generation.completed` rows whose `metadata.assetId` already appears
 * as a `generation.created` row in the same page. UI-only dedupe; the
 * underlying ledger keeps both rows (append-only invariant — FR-001).
 *
 * Why both rows exist: image and video generate routes emit
 * `generation.created` (new asset) AND `generation.completed` (the
 * generations row flipping to 'completed') back-to-back in the same
 * handler. They're conceptually the same user-facing event ("your
 * generation finished"); rendering both would double-count.
 *
 * Applied at both the page (server-side first page) and the API route
 * (paginated subsequent pages) so the dedupe is consistent.
 *
 * Caveat: this is a *page-local* dedupe — if a `created` and its sibling
 * `completed` straddle a page boundary, the `completed` row will leak
 * onto the next page. Acceptable for v1 (default page size 50; the two
 * sibling rows are ~ms apart in time, so they almost always live in the
 * same page). A future enhancement could either (a) drop `.completed`
 * emission entirely now that we know the UI doesn't want it, or
 * (b) carry the source row's id in metadata for cross-page dedupe.
 */
export function dedupeCoEmittedCompleted(
  items: HydratedActivityEvent[]
): HydratedActivityEvent[] {
  const createdAssetIds = new Set<string>();
  for (const e of items) {
    if (e.verb === "generation.created" && e.object.type === "asset") {
      createdAssetIds.add(e.object.id);
    }
  }
  return items.filter((e) => {
    if (e.verb !== "generation.completed") return true;
    const assetId =
      typeof e.metadata.assetId === "string"
        ? (e.metadata.assetId as string)
        : null;
    if (assetId && createdAssetIds.has(assetId)) return false;
    return true;
  });
}
