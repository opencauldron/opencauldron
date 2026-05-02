/**
 * Activity feed tab queries — integration tests (T042).
 *
 * Coverage:
 *   - Tab semantics: For-you / My-brands / Workspace each return only the
 *     events the user is entitled to. Critical: non-members never see brand
 *     events; private events never leak to anyone but the actor.
 *   - Cursor pagination: stable under concurrent inserts (no skipped or
 *     duplicated rows).
 *   - Cursor encode/decode round-trip + invalid input rejection.
 *   - Hydration: actor + brand + asset + feat populated in the right shapes.
 *
 * Gating: `INTEGRATION_DATABASE_URL` (matches every other tests/integration
 * file in the repo).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as NeonPool } from "@neondatabase/serverless";
import * as schema from "@/lib/db/schema";
import { activityEvents } from "@/lib/db/schema";
import { emitActivity, type ActivityVerb, type ActivityVisibility } from "@/lib/activity";
import {
  decodeActivityCursor,
  encodeActivityCursor,
  hydrateActivityEvents,
  loadForYouTab,
  loadMyBrandsTab,
  loadWorkspaceTab,
} from "@/lib/activity-feed";

dotenv.config({ path: ".env.local" });

const url = process.env.INTEGRATION_DATABASE_URL;
const enabled = !!url;
const setupPool = enabled ? new Pool({ connectionString: url }) : null;
const neonPool = enabled ? new NeonPool({ connectionString: url! }) : null;
const drizzleDb = neonPool ? drizzleNeon({ client: neonPool, schema }) : null;

async function exec(s: string, params?: unknown[]) {
  if (!setupPool) throw new Error("setupPool unset");
  return setupPool.query(s, params);
}

interface World {
  workspaceId: string;
  /** Workspace owner — also a brand_member of brandA + brandB. */
  ownerId: string;
  /** Plain workspace member, NO brand memberships. */
  memberId: string;
  /** Outsider — different workspace entirely. */
  outsiderId: string;
  outsiderWorkspaceId: string;
  /** The owner's personal brand in `workspaceId`. */
  ownerPersonalBrandId: string;
  /** Two managed brands in `workspaceId`. Owner is a member of both;
   *  member is a member of brandB only. */
  brandAId: string;
  brandBId: string;
}

const worlds: World[] = [];

async function makeWorld(label: string): Promise<World> {
  const stamp = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const ownerId = (
    await exec(
      `INSERT INTO users (email, name, role) VALUES ($1, 'Owner', 'admin') RETURNING id`,
      [`owner-${stamp}@feed.test.local`]
    )
  ).rows[0].id as string;
  const memberId = (
    await exec(
      `INSERT INTO users (email, name, role) VALUES ($1, 'Member', 'member') RETURNING id`,
      [`member-${stamp}@feed.test.local`]
    )
  ).rows[0].id as string;
  const outsiderId = (
    await exec(
      `INSERT INTO users (email, name, role) VALUES ($1, 'Outsider', 'member') RETURNING id`,
      [`outsider-${stamp}@feed.test.local`]
    )
  ).rows[0].id as string;

  const workspaceId = (
    await exec(
      `INSERT INTO workspaces (name, slug) VALUES ($1, $1) RETURNING id`,
      [`ws-${stamp}`]
    )
  ).rows[0].id as string;
  const outsiderWorkspaceId = (
    await exec(
      `INSERT INTO workspaces (name, slug) VALUES ($1, $1) RETURNING id`,
      [`outsider-ws-${stamp}`]
    )
  ).rows[0].id as string;

  await exec(
    `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
       ($1, $2, 'owner'),
       ($1, $3, 'member'),
       ($4, $5, 'owner')`,
    [workspaceId, ownerId, memberId, outsiderWorkspaceId, outsiderId]
  );

  const brandAId = (
    await exec(
      `INSERT INTO brands (workspace_id, name, slug, created_by, is_personal)
       VALUES ($1, $2, $2, $3, false) RETURNING id`,
      [workspaceId, `brand-a-${stamp}`, ownerId]
    )
  ).rows[0].id as string;
  const brandBId = (
    await exec(
      `INSERT INTO brands (workspace_id, name, slug, created_by, is_personal)
       VALUES ($1, $2, $2, $3, false) RETURNING id`,
      [workspaceId, `brand-b-${stamp}`, ownerId]
    )
  ).rows[0].id as string;
  const ownerPersonalBrandId = (
    await exec(
      `INSERT INTO brands (workspace_id, name, slug, created_by, is_personal, owner_id)
       VALUES ($1, $2, $2, $3, true, $3) RETURNING id`,
      [workspaceId, `personal-${stamp}`, ownerId]
    )
  ).rows[0].id as string;

  await exec(
    `INSERT INTO brand_members (brand_id, user_id, role) VALUES
       ($1, $3, 'brand_manager'),
       ($2, $3, 'brand_manager'),
       ($2, $4, 'creator')`,
    [brandAId, brandBId, ownerId, memberId]
  );

  const w: World = {
    workspaceId,
    ownerId,
    memberId,
    outsiderId,
    outsiderWorkspaceId,
    ownerPersonalBrandId,
    brandAId,
    brandBId,
  };
  worlds.push(w);
  return w;
}

async function emit(
  w: World,
  verb: ActivityVerb,
  visibility: ActivityVisibility,
  opts: {
    actorId: string;
    objectType?: string;
    objectId?: string;
    brandId?: string | null;
    workspaceOverrideId?: string;
    metadata?: Record<string, unknown>;
  }
) {
  return emitActivity(drizzleDb!, {
    actorId: opts.actorId,
    verb,
    objectType: opts.objectType ?? "asset",
    objectId: opts.objectId ?? "00000000-0000-0000-0000-000000000000",
    workspaceId: opts.workspaceOverrideId ?? w.workspaceId,
    brandId: opts.brandId ?? null,
    visibility,
    metadata: opts.metadata ?? {},
  });
}

async function cleanupAll() {
  for (const w of worlds) {
    try {
      await exec(`DELETE FROM activity_events WHERE workspace_id IN ($1, $2)`, [
        w.workspaceId,
        w.outsiderWorkspaceId,
      ]);
      await exec(`DELETE FROM brand_members WHERE user_id IN ($1, $2, $3)`, [
        w.ownerId,
        w.memberId,
        w.outsiderId,
      ]);
      await exec(`DELETE FROM brands WHERE workspace_id IN ($1, $2)`, [
        w.workspaceId,
        w.outsiderWorkspaceId,
      ]);
      await exec(`DELETE FROM workspace_members WHERE workspace_id IN ($1, $2)`, [
        w.workspaceId,
        w.outsiderWorkspaceId,
      ]);
      await exec(`DELETE FROM workspaces WHERE id IN ($1, $2)`, [
        w.workspaceId,
        w.outsiderWorkspaceId,
      ]);
      await exec(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [
        w.ownerId,
        w.memberId,
        w.outsiderId,
      ]);
    } catch (e) {
      console.warn("cleanup failed:", e);
    }
  }
}

describe.skipIf(!enabled)("Cursor encode/decode", () => {
  it("round-trips a valid (createdAt, id) pair", () => {
    const c = {
      createdAt: "2026-05-02T12:34:56.789Z",
      id: "11111111-2222-3333-4444-555555555555",
    };
    const token = encodeActivityCursor(c);
    expect(decodeActivityCursor(token)).toEqual(c);
  });

  it("rejects garbage tokens with null", () => {
    expect(decodeActivityCursor("not-base64-and-no-pipe")).toBeNull();
    expect(decodeActivityCursor(Buffer.from("nopipe").toString("base64url"))).toBeNull();
    expect(
      decodeActivityCursor(Buffer.from("not-a-date|abc").toString("base64url"))
    ).toBeNull();
  });
});

describe.skipIf(!enabled)("Activity feed — tab visibility (T042)", () => {
  beforeAll(async () => {
    if (!enabled) return;
    const r = await exec(`SELECT to_regclass('public.activity_events') AS t`);
    if (!r.rows[0].t) {
      throw new Error(
        "activity_events table not found — apply migration 0023 first."
      );
    }
  });

  it("Workspace tab returns only workspace-visibility events for the workspace", async () => {
    const w = await makeWorld("ws-tab");
    // Mix of events
    await emit(w, "member.leveled_up", "workspace", {
      actorId: w.ownerId,
      objectType: "user",
      objectId: w.ownerId,
      metadata: { level: 2 },
    });
    await emit(w, "member.earned_feat", "workspace", {
      actorId: w.memberId,
      objectType: "feat",
      objectId: "first-brew",
    });
    // brand event — must NOT appear in the workspace tab
    await emit(w, "generation.approved", "brand", {
      actorId: w.ownerId,
      brandId: w.brandAId,
    });
    // private event — must NOT appear
    await emit(w, "generation.created", "private", {
      actorId: w.ownerId,
      brandId: w.ownerPersonalBrandId,
    });
    // workspace event in OTHER workspace — must NOT appear
    await emit(w, "member.leveled_up", "workspace", {
      actorId: w.outsiderId,
      objectType: "user",
      objectId: w.outsiderId,
      workspaceOverrideId: w.outsiderWorkspaceId,
    });

    const ownerView = await loadWorkspaceTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
    });
    expect(ownerView).toHaveLength(2);
    const verbs = ownerView.map((r) => r.verb).sort();
    expect(verbs).toEqual(["member.earned_feat", "member.leveled_up"]);
    expect(ownerView.every((r) => r.visibility === "workspace")).toBe(true);
    expect(ownerView.every((r) => r.workspaceId === w.workspaceId)).toBe(true);

    // Member sees the same workspace events.
    const memberView = await loadWorkspaceTab({
      userId: w.memberId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
    });
    expect(memberView.map((r) => r.id).sort()).toEqual(
      ownerView.map((r) => r.id).sort()
    );
  });

  it("My-brands tab returns brand events ONLY for brands the user is a member of", async () => {
    const w = await makeWorld("brands-tab");
    // brand A (owner is member, member is NOT)
    await emit(w, "generation.submitted", "brand", {
      actorId: w.ownerId,
      brandId: w.brandAId,
    });
    // brand B (both owner and member are members)
    await emit(w, "generation.approved", "brand", {
      actorId: w.ownerId,
      brandId: w.brandBId,
    });
    // workspace event — must NOT appear in my-brands
    await emit(w, "member.leveled_up", "workspace", {
      actorId: w.memberId,
      objectType: "user",
      objectId: w.memberId,
    });
    // private event — must NOT appear
    await emit(w, "generation.created", "private", {
      actorId: w.memberId,
      brandId: w.ownerPersonalBrandId,
    });

    const ownerView = await loadMyBrandsTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
    });
    expect(ownerView).toHaveLength(2);
    expect(new Set(ownerView.map((r) => r.brandId))).toEqual(
      new Set([w.brandAId, w.brandBId])
    );
    expect(ownerView.every((r) => r.visibility === "brand")).toBe(true);

    // Member only sees brand B (not a member of A) — critical visibility test.
    const memberView = await loadMyBrandsTab({
      userId: w.memberId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
    });
    expect(memberView).toHaveLength(1);
    expect(memberView[0].brandId).toBe(w.brandBId);
    expect(memberView[0].verb).toBe("generation.approved");
  });

  it("My-brands tab returns empty when the user has no managed brand memberships", async () => {
    const w = await makeWorld("brands-tab-empty");
    // Member is in workspace + brandB by default; remove that membership.
    await exec(
      `DELETE FROM brand_members WHERE user_id = $1 AND brand_id IN ($2, $3)`,
      [w.memberId, w.brandAId, w.brandBId]
    );

    // Seed some brand events anyway — the member must not see them.
    await emit(w, "generation.approved", "brand", {
      actorId: w.ownerId,
      brandId: w.brandAId,
    });
    await emit(w, "generation.approved", "brand", {
      actorId: w.ownerId,
      brandId: w.brandBId,
    });

    const memberView = await loadMyBrandsTab({
      userId: w.memberId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
    });
    expect(memberView).toEqual([]);
  });

  it("My-brands tab does NOT include the user's own personal brand events", async () => {
    const w = await makeWorld("brands-tab-personal");
    // A "brand"-visibility event on the owner's own personal brand. Even if
    // visibility is brand, my-brands should exclude it (plan assumption:
    // personal brands surface in For-you, not here).
    await emit(w, "generation.created", "brand", {
      actorId: w.ownerId,
      brandId: w.ownerPersonalBrandId,
    });

    const ownerView = await loadMyBrandsTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
    });
    expect(ownerView).toHaveLength(0);
  });

  it("For-you tab includes own-actor + workspace + own-asset events; excludes others' brand-only", async () => {
    const w = await makeWorld("for-you-tab");

    // 1. Own-actor event (any visibility)
    await emit(w, "generation.created", "private", {
      actorId: w.memberId,
      brandId: w.ownerPersonalBrandId,
    });
    // 2. Workspace event (someone else)
    await emit(w, "member.leveled_up", "workspace", {
      actorId: w.ownerId,
      objectType: "user",
      objectId: w.ownerId,
    });
    // 3. Brand event the member is NOT in (brandA) on someone else's asset
    //    → should NOT appear in member's For-you.
    await emit(w, "generation.approved", "brand", {
      actorId: w.ownerId,
      brandId: w.brandAId,
    });

    // 4. Brand event ON an asset the MEMBER created — should appear via the
    //    own-asset clause. Seed an asset owned by the member first.
    const ownAssetId = (
      await exec(
        `INSERT INTO assets
           (user_id, brand_id, source, media_type, model, provider, prompt, r2_key, r2_url)
         VALUES ($1, $2, 'uploaded', 'image', 'm', 'p', 'q', 'k', 'u')
         RETURNING id`,
        [w.memberId, w.brandAId]
      )
    ).rows[0].id as string;
    await emit(w, "generation.approved", "brand", {
      actorId: w.ownerId,
      brandId: w.brandAId,
      objectType: "asset",
      objectId: ownAssetId,
    });

    const memberView = await loadForYouTab({
      userId: w.memberId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
    });

    // Should contain (1) own private create, (2) workspace level-up, (4)
    // approval on own asset. Should NOT contain (3) brand-only on a brand
    // they're not in.
    const verbs = memberView.map((r) => r.verb).sort();
    expect(verbs).toEqual([
      "generation.approved",
      "generation.created",
      "member.leveled_up",
    ]);
    // Cleanup the seeded asset for hygiene.
    await exec(`DELETE FROM activity_events WHERE object_id = $1`, [ownAssetId]);
    await exec(`DELETE FROM assets WHERE id = $1`, [ownAssetId]);
  });

  it("For-you tab does NOT include another user's private events", async () => {
    const w = await makeWorld("for-you-private-leak");

    // Owner emits a private event (their own personal brand).
    await emit(w, "generation.created", "private", {
      actorId: w.ownerId,
      brandId: w.ownerPersonalBrandId,
    });

    const memberView = await loadForYouTab({
      userId: w.memberId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
    });
    expect(memberView).toHaveLength(0);

    const outsiderView = await loadForYouTab({
      userId: w.outsiderId,
      // Outsider scoped to OWNER's workspace — even with that they shouldn't
      // see the private event because they aren't the actor.
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
    });
    expect(outsiderView).toHaveLength(0);
  });
});

describe.skipIf(!enabled)("Activity feed — cursor pagination (T042)", () => {
  it("paginates with stable order under interleaved inserts", async () => {
    const w = await makeWorld("cursor");

    // Seed 10 workspace-visibility events with explicit createdAt so we
    // control the sort exactly. Note actor_id is uuid, object_id is text;
    // pg can't deduce both from a single $1 placeholder, so they bind to
    // separate positional params.
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await exec(
        `INSERT INTO activity_events
           (actor_id, verb, object_type, object_id, workspace_id, visibility, metadata, created_at)
         VALUES ($1, 'member.leveled_up', 'user', $2, $3, 'workspace', $4::jsonb, $5)
         RETURNING id, created_at`,
        [
          w.ownerId,
          w.ownerId, // object_id (text) — same value, different declared type
          w.workspaceId,
          JSON.stringify({ seq: i }),
          new Date(Date.now() - (10 - i) * 1000).toISOString(),
        ]
      );
      ids.push(r.rows[0].id as string);
    }
    // Reverse — newest first.
    const expectedDescOrder = [...ids].reverse();

    // Page 1 — limit 4.
    const page1 = await loadWorkspaceTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 4,
    });
    expect(page1.map((r) => r.id)).toEqual(expectedDescOrder.slice(0, 4));

    // Insert ANOTHER row mid-paginate — older timestamp than the cursor head
    // so it doesn't intrude into already-seen pages. Should appear in a later
    // page if it sorts there.
    await exec(
      `INSERT INTO activity_events
         (actor_id, verb, object_type, object_id, workspace_id, visibility, metadata, created_at)
       VALUES ($1, 'member.leveled_up', 'user', $2, $3, 'workspace', '{"seq":-1}'::jsonb, $4)`,
      [
        w.ownerId,
        w.ownerId,
        w.workspaceId,
        new Date(Date.now() - 999_000).toISOString(),
      ]
    );

    const cursor = {
      createdAt: page1[3].createdAt.toISOString(),
      id: page1[3].id,
    };
    const page2 = await loadWorkspaceTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor,
      limit: 4,
    });
    // Page 2 must continue strictly after page 1's tail — no duplicates.
    expect(page2.map((r) => r.id)).toEqual(expectedDescOrder.slice(4, 8));
    const page1Ids = new Set(page1.map((r) => r.id));
    expect(page2.every((r) => !page1Ids.has(r.id))).toBe(true);

    // Page 3 — limit 4 should fetch the remaining (2 originals + 1 inserted).
    const cursor2 = {
      createdAt: page2[3].createdAt.toISOString(),
      id: page2[3].id,
    };
    const page3 = await loadWorkspaceTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor: cursor2,
      limit: 4,
    });
    expect(page3.length).toBe(3);
    // The two original tail rows + the late-inserted row.
    expect(page3[0].id).toBe(expectedDescOrder[8]);
    expect(page3[1].id).toBe(expectedDescOrder[9]);
    expect((page3[2].metadata as { seq: number }).seq).toBe(-1);
  });
});

describe.skipIf(!enabled)("Activity feed — hydration (T043)", () => {
  it("populates actor + brand + asset + feat in the right shapes", async () => {
    const w = await makeWorld("hydrate");

    // Seed a real asset so the hydrator can join it.
    const assetId = (
      await exec(
        `INSERT INTO assets
           (user_id, brand_id, source, media_type, model, provider, prompt, r2_key, r2_url)
         VALUES ($1, $2, 'generated', 'image', 'm', 'p', 'a hydrated prompt', 'k', 'u')
         RETURNING id`,
        [w.ownerId, w.brandAId]
      )
    ).rows[0].id as string;

    await emit(w, "generation.created", "brand", {
      actorId: w.ownerId,
      brandId: w.brandAId,
      objectType: "asset",
      objectId: assetId,
    });
    await emit(w, "member.earned_feat", "workspace", {
      actorId: w.ownerId,
      objectType: "feat",
      objectId: "first-brew",
    });

    const raws = await loadForYouTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
    });
    const items = await hydrateActivityEvents(raws, {
      // No-op storage resolver — tests don't reach R2.
      getThumbnailUrl: async () => null,
    });

    const created = items.find((i) => i.verb === "generation.created");
    expect(created).toBeDefined();
    expect(created!.actor.id).toBe(w.ownerId);
    expect(created!.actor.name).toBe("Owner");
    expect(created!.brand?.id).toBe(w.brandAId);
    expect(created!.brand?.isPersonal).toBe(false);
    expect(created!.object).toMatchObject({
      type: "asset",
      id: assetId,
      prompt: "a hydrated prompt",
      mediaType: "image",
    });
    expect(created!.href).toBe(`/library?asset=${assetId}`);

    const feat = items.find((i) => i.verb === "member.earned_feat");
    expect(feat).toBeDefined();
    expect(feat!.brand).toBeNull();
    expect(feat!.object).toMatchObject({
      type: "feat",
      id: "first-brew",
      // first-brew badge name is seeded as "First Brew", icon "FlaskConical"
      name: "First Brew",
      icon: "FlaskConical",
    });
    // Spec US1 acceptance criterion #6 — every row navigates to a canonical
    // detail surface. Feats route to the actor's profile (post-Designer
    // review fix). Same fallback applies to generation rows when the
    // backing asset has been deleted.
    expect(feat!.href).toBe(`/profile/${w.ownerId}`);

    // Cleanup the asset.
    await exec(`DELETE FROM activity_events WHERE object_id = $1`, [assetId]);
    await exec(`DELETE FROM assets WHERE id = $1`, [assetId]);
  });

  it("returns object: { type: 'unknown' } when the related row is missing", async () => {
    const w = await makeWorld("hydrate-missing");

    // Emit pointing at a non-existent asset — the hydrator should degrade
    // gracefully rather than throwing.
    const ghostId = "00000000-0000-0000-0000-000000000001";
    await emit(w, "generation.created", "brand", {
      actorId: w.ownerId,
      brandId: w.brandAId,
      objectType: "asset",
      objectId: ghostId,
    });

    const raws = await loadForYouTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
    });
    const items = await hydrateActivityEvents(raws);
    const row = items.find((i) => i.verb === "generation.created");
    expect(row?.object).toEqual({ type: "unknown", id: ghostId });
    expect(row?.href).toBeNull();
  });
});

// Suppress "unused" warnings — kept as documentation of the schema deps.
void activityEvents;
void eq;

describe.skipIf(!enabled)("Activity feed — teardown", () => {
  afterAll(async () => {
    await cleanupAll();
    await setupPool?.end();
    await neonPool?.end();
  });
  it("placeholder — keeps the suite from being empty", () => {
    expect(true).toBe(true);
  });
});
