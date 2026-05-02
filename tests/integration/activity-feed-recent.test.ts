/**
 * `loadRecentActivity()` integration tests (T060 / US3).
 *
 * Locks the visibility union the dashboard rail relies on:
 *   - workspace events visible to all members
 *   - private events visible only to their actor
 *   - brand events visible only to brand members (non-personal brands)
 * Plus the cross-workspace isolation rule (NFR-004) and the co-emit
 * dedupe (Phase 4 QA flag — both `generation.created` and
 * `generation.completed` exist in the ledger; the rail must show only one).
 *
 * Reuses the world / seed pattern from `activity-feed-tabs.test.ts`.
 *
 * Gating: `INTEGRATION_DATABASE_URL` (matches every other tests/integration
 * file in the repo).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import dotenv from "dotenv";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as NeonPool } from "@neondatabase/serverless";
import * as schema from "@/lib/db/schema";
import {
  emitActivity,
  type ActivityVerb,
  type ActivityVisibility,
} from "@/lib/activity";
import {
  dedupeCoEmittedCompleted,
  hydrateActivityEvents,
  loadRecentActivity,
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
  ownerId: string;
  /** Plain workspace member; member of brandB only. */
  memberId: string;
  /** Outsider in a different workspace entirely. */
  outsiderId: string;
  outsiderWorkspaceId: string;
  ownerPersonalBrandId: string;
  brandAId: string;
  brandBId: string;
}

const worlds: World[] = [];

async function makeWorld(label: string): Promise<World> {
  const stamp = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ownerId = (
    await exec(
      `INSERT INTO users (email, name, role) VALUES ($1, 'Owner', 'admin') RETURNING id`,
      [`owner-${stamp}@recent.test.local`]
    )
  ).rows[0].id as string;
  const memberId = (
    await exec(
      `INSERT INTO users (email, name, role) VALUES ($1, 'Member', 'member') RETURNING id`,
      [`member-${stamp}@recent.test.local`]
    )
  ).rows[0].id as string;
  const outsiderId = (
    await exec(
      `INSERT INTO users (email, name, role) VALUES ($1, 'Outsider', 'member') RETURNING id`,
      [`outsider-${stamp}@recent.test.local`]
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

describe.skipIf(!enabled)("loadRecentActivity (T060 / US3)", () => {
  beforeAll(async () => {
    if (!enabled) return;
    const r = await exec(`SELECT to_regclass('public.activity_events') AS t`);
    if (!r.rows[0].t) {
      throw new Error(
        "activity_events table not found — apply migration 0023 first."
      );
    }
  });

  it("returns workspace + actor-private + brand-member events; excludes brand events the user isn't in", async () => {
    const w = await makeWorld("recent-union");

    // Owner is brand_manager on A and B. Member is creator on B only.
    // Outsider is in a different workspace entirely.
    await emit(w, "member.leveled_up", "workspace", {
      actorId: w.memberId,
      objectType: "user",
      objectId: w.memberId,
    });
    await emit(w, "generation.created", "private", {
      actorId: w.ownerId,
      brandId: w.ownerPersonalBrandId,
    });
    // Brand A — only owner is a member.
    const brandAEventId = (await emit(w, "generation.approved", "brand", {
      actorId: w.ownerId,
      brandId: w.brandAId,
    })).id;
    // Brand B — both owner and member are members.
    const brandBEventId = (await emit(w, "generation.submitted", "brand", {
      actorId: w.ownerId,
      brandId: w.brandBId,
    })).id;

    const ownerView = await loadRecentActivity({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      limit: 10,
    });
    // Owner sees: workspace event, their own private event, brand A, brand B.
    expect(ownerView).toHaveLength(4);
    const ownerVerbs = new Set(ownerView.map((r) => r.verb));
    expect(ownerVerbs).toEqual(
      new Set([
        "member.leveled_up",
        "generation.created",
        "generation.approved",
        "generation.submitted",
      ])
    );

    const memberView = await loadRecentActivity({
      userId: w.memberId,
      workspaceId: w.workspaceId,
      limit: 10,
    });
    // Member sees: workspace event + brand B (member of B). Doesn't see
    // owner's private event; doesn't see brand A (not a member).
    expect(memberView).toHaveLength(2);
    expect(memberView.map((r) => r.id).sort()).toEqual(
      [
        // workspace event id (member.leveled_up was emitted with member as
        // actor; we don't track that id directly above so just assert the
        // brand-B id is present and the count is right).
        memberView.find((r) => r.verb === "member.leveled_up")!.id,
        brandBEventId,
      ].sort()
    );
    // Brand-A leak guard.
    expect(memberView.some((r) => r.id === brandAEventId)).toBe(false);

    // Outsider scoped at the same workspace_id (e.g. forged client header)
    // would still see workspace-visibility events because the API trusts the
    // server-resolved workspace, but at the LIB layer we intentionally don't
    // re-check membership — the route layer is the boundary. The cross-
    // workspace isolation we DO test below is "outsider in their own
    // workspace doesn't see this workspace's events at all."
    const outsiderInOwnWorkspace = await loadRecentActivity({
      userId: w.outsiderId,
      workspaceId: w.outsiderWorkspaceId,
      limit: 10,
    });
    expect(outsiderInOwnWorkspace).toEqual([]);
  });

  it("includes brand events on assets the user CREATED, even when they aren't a brand member", async () => {
    // Spec compliance fix: the rail must be a superset of /activity's
    // For-you tab. For-you includes "events on objects I created"; the
    // rail was missing that leg pre-fix. Real scenario: Alice approves
    // Bob's asset in a brand Bob isn't (or isn't anymore) a member of.
    const w = await makeWorld("recent-own-asset");

    // Bob = the workspace member (NOT a member of brand A — owner is the
    // brand_manager on A, member only got brand_member on B in the seed).
    const bobId = w.memberId;
    const aliceId = w.ownerId;

    // Bob owns an asset that's been moved to / lives on brand A. Seed the
    // assets row directly so the FK to brand A exists.
    const bobAssetId = (
      await exec(
        `INSERT INTO assets
           (user_id, brand_id, source, media_type, model, provider, prompt, r2_key, r2_url)
         VALUES ($1, $2, 'generated', 'image', 'm', 'p', 'q', 'k', 'u')
         RETURNING id`,
        [bobId, w.brandAId]
      )
    ).rows[0].id as string;

    // Alice (brand A manager) approves Bob's asset. Visibility = brand,
    // brand_id = brand A — Bob is NOT in brand A.
    const approvedEventId = (
      await emit(w, "generation.approved", "brand", {
        actorId: aliceId,
        brandId: w.brandAId,
        objectType: "asset",
        objectId: bobAssetId,
      })
    ).id;

    // Pre-fix this would return 0 rows for Bob (workspace = no, private = no,
    // brand-membership = no). Post-fix the own-asset leg fires.
    const bobView = await loadRecentActivity({
      userId: bobId,
      workspaceId: w.workspaceId,
      limit: 10,
    });
    const ids = bobView.map((r) => r.id);
    expect(ids).toContain(approvedEventId);

    // Cleanup the seeded asset to keep the world's cleanupAll fast.
    await exec(`DELETE FROM activity_events WHERE object_id = $1`, [bobAssetId]);
    await exec(`DELETE FROM assets WHERE id = $1`, [bobAssetId]);
  });

  it("excludes the user's own personal brand from the brand-member set", async () => {
    const w = await makeWorld("recent-personal");

    // A "brand"-visibility event on the owner's own personal brand. Even if
    // visibility=brand it must NOT contribute via the brand-membership leg
    // (matches the my-brands tab semantic and avoids double-include with
    // the actor-private leg). The owner IS the actor, so the row also
    // appears via the actor-private leg if we'd seeded it as private —
    // but here we're testing the brand-leg exclusion specifically.
    //
    // Set up the brand-on-personal-brand scenario by emitting on the
    // personal brand with visibility=brand. This should NOT appear in
    // recent for the owner (the owner is the only person who'd see it
    // anyway, and only via the personal-brand-as-member path which we
    // explicitly exclude).
    await emit(w, "generation.created", "brand", {
      actorId: w.memberId, // not the owner — so the actor-private leg won't fire
      brandId: w.ownerPersonalBrandId,
    });

    const ownerView = await loadRecentActivity({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      limit: 10,
    });
    // Owner is the personal brand's owner, but the brand-membership leg
    // explicitly excludes personal brands → no row visible here.
    expect(ownerView).toHaveLength(0);
  });

  it("respects the limit cap (orders desc, returns at most N)", async () => {
    const w = await makeWorld("recent-limit");

    // Seed 15 workspace-visibility events with controlled timestamps.
    for (let i = 0; i < 15; i++) {
      await exec(
        `INSERT INTO activity_events
           (actor_id, verb, object_type, object_id, workspace_id, visibility, metadata, created_at)
         VALUES ($1, 'member.leveled_up', 'user', $2, $3, 'workspace', $4::jsonb, $5)`,
        [
          w.ownerId,
          w.ownerId,
          w.workspaceId,
          JSON.stringify({ seq: i }),
          new Date(Date.now() - (15 - i) * 1000).toISOString(),
        ]
      );
    }

    const view = await loadRecentActivity({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      limit: 10,
    });
    expect(view).toHaveLength(10);
    // Newest first — seq 14 down to 5.
    const seqs = view.map((r) => (r.metadata as { seq: number }).seq);
    expect(seqs).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
  });

  it("co-emit dedupe applies — generation.completed paired with .created is suppressed", async () => {
    const w = await makeWorld("recent-dedupe");

    // Seed an asset so the .created has a real target.
    const assetId = (
      await exec(
        `INSERT INTO assets
           (user_id, brand_id, source, media_type, model, provider, prompt, r2_key, r2_url)
         VALUES ($1, $2, 'generated', 'image', 'm', 'p', 'q', 'k', 'u')
         RETURNING id`,
        [w.ownerId, w.brandAId]
      )
    ).rows[0].id as string;

    // .created on the asset
    await emit(w, "generation.created", "brand", {
      actorId: w.ownerId,
      brandId: w.brandAId,
      objectType: "asset",
      objectId: assetId,
    });

    // .completed on a generation row with metadata.assetId = assetId — the
    // sibling co-emit case the dedupe is built for.
    const generationId = (
      await exec(
        `INSERT INTO generations (user_id, model, prompt, status, asset_id)
         VALUES ($1, 'imagen-4', 'q', 'completed', $2)
         RETURNING id`,
        [w.ownerId, assetId]
      )
    ).rows[0].id as string;
    await emit(w, "generation.completed", "brand", {
      actorId: w.ownerId,
      brandId: w.brandAId,
      objectType: "generation",
      objectId: generationId,
      metadata: { assetId, mediaType: "image", model: "imagen-4" },
    });

    const raw = await loadRecentActivity({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      limit: 10,
    });
    // The ledger has BOTH rows (append-only invariant).
    expect(raw).toHaveLength(2);

    const hydrated = await hydrateActivityEvents(raw, {
      getThumbnailUrl: async () => null,
    });
    const items = dedupeCoEmittedCompleted(hydrated);

    // After dedupe the rail should show ONE row (the .created — kept).
    expect(items).toHaveLength(1);
    expect(items[0].verb).toBe("generation.created");

    // Cleanup the seeded asset + generation.
    await exec(`DELETE FROM activity_events WHERE object_id = $1 OR object_id = $2`, [
      assetId,
      generationId,
    ]);
    await exec(`DELETE FROM generations WHERE id = $1`, [generationId]);
    await exec(`DELETE FROM assets WHERE id = $1`, [assetId]);
  });
});

describe.skipIf(!enabled)("recent-rail teardown", () => {
  afterAll(async () => {
    await cleanupAll();
    await setupPool?.end();
    await neonPool?.end();
  });
  it("placeholder — keeps the suite from being empty", () => {
    expect(true).toBe(true);
  });
});
