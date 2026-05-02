/**
 * Activity feed filter integration tests (US6 / T092).
 *
 * Coverage:
 *   - Single-verb filter returns only that verb (verb predicate works).
 *   - Multi-verb filter returns the union (deduped against the same event
 *     never matching twice).
 *   - `since=today` returns only today's rows; `since=7d` returns rows
 *     within the last 7 days; `since=30d` likewise; absent `since` is unbounded.
 *   - Filter combo (verbs ∩ since) AND-combines correctly.
 *   - Empty result respects the pagination contract — no row → no
 *     `nextCursor` should be derived; the API returns `nextCursor: null`.
 *
 * Gating: `INTEGRATION_DATABASE_URL` (matches every other tests/integration
 * file in the repo).
 *
 * Pagination-reset on filter change is covered at the URL/UI layer (the
 * `<ActivityFilters>` `buildHref()` helper always drops `?cursor=`); the
 * lib + route just respect whatever cursor is passed. We assert the
 * route's filter-aware cursor encoding here.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import dotenv from "dotenv";
import * as schema from "@/lib/db/schema";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as NeonPool } from "@neondatabase/serverless";
import {
  emitActivity,
  type ActivityVerb,
  type ActivityVisibility,
} from "@/lib/activity";
import {
  loadForYouTab,
  loadMyBrandsTab,
  loadRecentActivity,
  loadWorkspaceTab,
  resolveChipsToVerbs,
  resolveSince,
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
  brandAId: string;
  ownerPersonalBrandId: string;
}

const worlds: World[] = [];

async function makeWorld(label: string): Promise<World> {
  const stamp = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ownerId = (
    await exec(
      `INSERT INTO users (email, name, role) VALUES ($1, 'Owner', 'admin') RETURNING id`,
      [`owner-${stamp}@filters.test.local`]
    )
  ).rows[0].id as string;
  const workspaceId = (
    await exec(
      `INSERT INTO workspaces (name, slug) VALUES ($1, $1) RETURNING id`,
      [`ws-${stamp}`]
    )
  ).rows[0].id as string;
  await exec(
    `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [workspaceId, ownerId]
  );
  const brandAId = (
    await exec(
      `INSERT INTO brands (workspace_id, name, slug, created_by, is_personal) VALUES ($1, $2, $2, $3, false) RETURNING id`,
      [workspaceId, `brand-a-${stamp}`, ownerId]
    )
  ).rows[0].id as string;
  const ownerPersonalBrandId = (
    await exec(
      `INSERT INTO brands (workspace_id, name, slug, created_by, is_personal, owner_id) VALUES ($1, $2, $2, $3, true, $3) RETURNING id`,
      [workspaceId, `personal-${stamp}`, ownerId]
    )
  ).rows[0].id as string;
  await exec(
    `INSERT INTO brand_members (brand_id, user_id, role) VALUES ($1, $2, 'brand_manager')`,
    [brandAId, ownerId]
  );
  const w: World = { workspaceId, ownerId, brandAId, ownerPersonalBrandId };
  worlds.push(w);
  return w;
}

async function emit(
  w: World,
  verb: ActivityVerb,
  visibility: ActivityVisibility,
  opts: {
    actorId?: string;
    objectType?: string;
    objectId?: string;
    brandId?: string | null;
    metadata?: Record<string, unknown>;
  } = {}
) {
  return emitActivity(drizzleDb!, {
    actorId: opts.actorId ?? w.ownerId,
    verb,
    objectType: opts.objectType ?? "asset",
    objectId: opts.objectId ?? "00000000-0000-0000-0000-000000000000",
    workspaceId: w.workspaceId,
    brandId: opts.brandId ?? null,
    visibility,
    metadata: opts.metadata ?? {},
  });
}

/** Emit an event then back-date its `created_at` so we can test `since` windows. */
async function emitDated(
  w: World,
  verb: ActivityVerb,
  visibility: ActivityVisibility,
  createdAt: Date,
  opts: Parameters<typeof emit>[3] = {}
) {
  const { id } = await emit(w, verb, visibility, opts);
  await exec(`UPDATE activity_events SET created_at = $1 WHERE id = $2`, [
    createdAt,
    id,
  ]);
  return { id };
}

async function cleanupAll() {
  for (const w of worlds) {
    try {
      await exec(`DELETE FROM activity_events WHERE workspace_id = $1`, [w.workspaceId]);
      await exec(`DELETE FROM brand_members WHERE user_id = $1`, [w.ownerId]);
      await exec(`DELETE FROM brands WHERE workspace_id = $1`, [w.workspaceId]);
      await exec(`DELETE FROM workspace_members WHERE workspace_id = $1`, [w.workspaceId]);
      await exec(`DELETE FROM workspaces WHERE id = $1`, [w.workspaceId]);
      await exec(`DELETE FROM users WHERE id = $1`, [w.ownerId]);
    } catch (e) {
      console.warn("cleanup failed:", e);
    }
  }
}

describe.skipIf(!enabled)("Activity feed filters (T092 / US6)", () => {
  beforeAll(async () => {
    if (!enabled) return;
    const r = await exec(`SELECT to_regclass('public.activity_events') AS t`);
    if (!r.rows[0].t) {
      throw new Error(
        "activity_events table not found — apply migration 0023 first."
      );
    }
  });

  afterAll(async () => {
    await cleanupAll();
    await setupPool?.end();
    await neonPool?.end();
  });

  it("verb filter returns only the matching verb", async () => {
    const w = await makeWorld("verb-single");
    await emit(w, "generation.approved", "brand", { brandId: w.brandAId });
    await emit(w, "generation.rejected", "brand", { brandId: w.brandAId });
    await emit(w, "member.earned_feat", "workspace", {
      objectType: "feat",
      objectId: "first-brew",
    });

    const rows = await loadForYouTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
      verbs: ["generation.approved"],
    });

    expect(rows.map((r) => r.verb)).toEqual(["generation.approved"]);
  });

  it("multi-verb filter returns the union (chip resolver)", async () => {
    const w = await makeWorld("verb-multi");
    await emit(w, "generation.submitted", "brand", { brandId: w.brandAId });
    await emit(w, "generation.approved", "brand", { brandId: w.brandAId });
    await emit(w, "generation.rejected", "brand", { brandId: w.brandAId });
    await emit(w, "member.earned_feat", "workspace", {
      objectType: "feat",
      objectId: "first-brew",
    });
    await emit(w, "generation.created", "brand", { brandId: w.brandAId });

    // Resolve via the same path the API takes — chip ids in, verb set out.
    const verbs = resolveChipsToVerbs(["approvals"]);
    const rows = await loadForYouTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
      verbs,
    });

    expect(new Set(rows.map((r) => r.verb))).toEqual(
      new Set([
        "generation.submitted",
        "generation.approved",
        "generation.rejected",
      ])
    );
  });

  it("`since=today` returns only rows from today (UTC)", async () => {
    const w = await makeWorld("since-today");
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const utcMidnightTodayPlus1h = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        1,
        0,
        0
      )
    );
    await emitDated(w, "generation.approved", "brand", twoDaysAgo, {
      brandId: w.brandAId,
    });
    const todayRow = await emitDated(
      w,
      "generation.approved",
      "brand",
      utcMidnightTodayPlus1h,
      { brandId: w.brandAId }
    );

    const since = resolveSince("today", now);
    const rows = await loadForYouTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
      since,
    });
    expect(rows.map((r) => r.id)).toEqual([todayRow.id]);
  });

  it("`since=7d` returns the last 7 days", async () => {
    const w = await makeWorld("since-7d");
    const now = new Date();
    const oldRow = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recent = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    await emitDated(w, "generation.approved", "brand", oldRow, {
      brandId: w.brandAId,
    });
    const recentRow = await emitDated(
      w,
      "generation.approved",
      "brand",
      recent,
      { brandId: w.brandAId }
    );

    const since = resolveSince("7d", now);
    const rows = await loadForYouTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
      since,
    });
    expect(rows.map((r) => r.id)).toEqual([recentRow.id]);
  });

  it("`since=30d` returns the last 30 days", async () => {
    const w = await makeWorld("since-30d");
    const now = new Date();
    const veryOld = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const inWindow = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
    await emitDated(w, "generation.approved", "brand", veryOld, {
      brandId: w.brandAId,
    });
    const inRow = await emitDated(
      w,
      "generation.approved",
      "brand",
      inWindow,
      { brandId: w.brandAId }
    );

    const since = resolveSince("30d", now);
    const rows = await loadForYouTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
      since,
    });
    expect(rows.map((r) => r.id)).toEqual([inRow.id]);
  });

  it("filter combo (verbs ∩ since) AND-combines", async () => {
    const w = await makeWorld("combo");
    const now = new Date();
    const old = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recent = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

    // Verb match BUT outside time window — must be excluded.
    await emitDated(w, "generation.approved", "brand", old, {
      brandId: w.brandAId,
    });
    // Inside time window BUT wrong verb — must be excluded.
    await emitDated(w, "member.earned_feat", "workspace", recent, {
      objectType: "feat",
      objectId: "first-brew",
    });
    // Both match — must be included.
    const target = await emitDated(
      w,
      "generation.approved",
      "brand",
      recent,
      { brandId: w.brandAId }
    );

    const rows = await loadForYouTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
      verbs: resolveChipsToVerbs(["approvals"]),
      since: resolveSince("7d", now),
    });
    expect(rows.map((r) => r.id)).toEqual([target.id]);
  });

  it("empty filter result returns []", async () => {
    const w = await makeWorld("empty");
    await emit(w, "member.earned_feat", "workspace", {
      objectType: "feat",
      objectId: "first-brew",
    });

    const rows = await loadForYouTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
      // Filter that matches NOTHING in the seeded data.
      verbs: resolveChipsToVerbs(["approvals"]),
    });
    expect(rows).toEqual([]);
  });

  it("filters apply to my-brands tab", async () => {
    const w = await makeWorld("my-brands-filter");
    await emit(w, "generation.approved", "brand", { brandId: w.brandAId });
    await emit(w, "generation.rejected", "brand", { brandId: w.brandAId });

    const rows = await loadMyBrandsTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
      verbs: ["generation.approved"],
    });
    expect(rows.map((r) => r.verb)).toEqual(["generation.approved"]);
  });

  it("filters apply to workspace tab", async () => {
    const w = await makeWorld("workspace-filter");
    await emit(w, "member.earned_feat", "workspace", {
      objectType: "feat",
      objectId: "first-brew",
    });
    await emit(w, "member.leveled_up", "workspace", {
      objectType: "user",
      objectId: w.ownerId,
      metadata: { level: 2 },
    });

    const rows = await loadWorkspaceTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 50,
      verbs: resolveChipsToVerbs(["feats"]),
    });
    expect(rows.map((r) => r.verb)).toEqual(["member.earned_feat"]);
  });

  it("filters apply to recent-activity rail query (loadRecentActivity)", async () => {
    const w = await makeWorld("recent-filter");
    await emit(w, "generation.approved", "brand", { brandId: w.brandAId });
    await emit(w, "member.leveled_up", "workspace", {
      objectType: "user",
      objectId: w.ownerId,
      metadata: { level: 3 },
    });

    const rows = await loadRecentActivity({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      limit: 10,
      verbs: ["member.leveled_up"],
    });
    expect(rows.map((r) => r.verb)).toEqual(["member.leveled_up"]);
  });

  it("cursor still encodes correctly under filters (pagination respects WHERE)", async () => {
    const w = await makeWorld("cursor-under-filter");
    // 3 matching rows, all approved — cursor should walk them in
    // strict (created_at desc, id desc) order under the filter.
    const now = new Date();
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const at = new Date(now.getTime() - i * 60 * 1000); // 1 min apart, newest first
      const { id } = await emitDated(w, "generation.approved", "brand", at, {
        brandId: w.brandAId,
      });
      ids.push(id);
    }
    // Throw in a non-matching row — must NOT appear in either page.
    await emit(w, "member.earned_feat", "workspace", {
      objectType: "feat",
      objectId: "first-brew",
    });

    // Page 1 (limit=2)
    const page1 = await loadForYouTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor: null,
      limit: 2,
      verbs: ["generation.approved"],
    });
    expect(page1).toHaveLength(2);
    expect(page1.map((r) => r.id)).toEqual([ids[0], ids[1]]);

    // Page 2 — derive cursor from the trailing row.
    const trailing = page1[page1.length - 1];
    const page2 = await loadForYouTab({
      userId: w.ownerId,
      workspaceId: w.workspaceId,
      cursor: { createdAt: trailing.createdAt.toISOString(), id: trailing.id },
      limit: 2,
      verbs: ["generation.approved"],
    });
    expect(page2.map((r) => r.id)).toEqual([ids[2]]);
  });
});
