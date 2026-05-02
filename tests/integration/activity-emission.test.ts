/**
 * Activity emission integration tests (T026 / T027 / T028).
 *
 * Coverage matrix — one test per v1 verb plus the rollback + visibility-
 * broadening cases:
 *
 *   T026 — per-verb tests (7 verbs):
 *     1. generation.created   (uploads-style asset insert + emitActivity)
 *     2. generation.submitted (transitionAsset 'submit')
 *     3. generation.approved  (transitionAsset 'approve')
 *     4. generation.rejected  (transitionAsset 'reject')
 *     5. generation.completed (generations row flip + emitActivity)
 *     6. member.earned_feat   (awardBadge / checkAndAwardBadges)
 *     7. member.leveled_up    (awardXP crossing a level threshold)
 *
 *   T027 — rollback safety: when a parent tx errors AFTER the emit, no row
 *          is written. (The live emission sites use the global HTTP db
 *          handle which doesn't support transactions; this test uses
 *          drizzle's neon-serverless adapter so the rollback path is real.)
 *
 *   T028 — visibility broadening: a private draft submitted onto a
 *          non-personal brand produces TWO rows — the original `private
 *          generation.created` UNCHANGED, and a new `brand
 *          generation.submitted` (FR-003).
 *
 * Gating: `INTEGRATION_DATABASE_URL` (matches every other tests/integration
 * file in the repo). Tests skip silently when unset.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import dotenv from "dotenv";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { and, eq, sql } from "drizzle-orm";
import {
  activityEvents,
  assets,
  generations,
  userBadges,
  userXp,
  xpTransactions,
} from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";
import { emitActivity } from "@/lib/activity";
import { transitionAsset } from "@/lib/transitions";
import { awardXP, checkAndAwardBadges, getLevelFromXP } from "@/lib/xp";

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

interface BaseSeed {
  workspaceId: string;
  actorId: string;
}

interface ManagedBrandSeed extends BaseSeed {
  brandId: string;
  isPersonal: false;
}

interface PersonalBrandSeed extends BaseSeed {
  brandId: string;
  isPersonal: true;
}

const seedRefs: BaseSeed[] = [];

async function seedBase(label: string): Promise<BaseSeed> {
  const stamp = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const actorId = (
    await exec(
      `INSERT INTO users (email, name, role)
       VALUES ($1, 'Actor', 'member')
       RETURNING id`,
      [`actor-${stamp}@activity.test.local`]
    )
  ).rows[0].id as string;

  const workspaceId = (
    await exec(
      `INSERT INTO workspaces (name, slug)
       VALUES ($1, $1)
       RETURNING id`,
      [`ws-${stamp}`]
    )
  ).rows[0].id as string;

  await exec(
    `INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
    [workspaceId, actorId]
  );

  const seed: BaseSeed = { workspaceId, actorId };
  seedRefs.push(seed);
  return seed;
}

async function seedManagedBrand(
  label: string,
  base?: BaseSeed
): Promise<ManagedBrandSeed> {
  const b = base ?? (await seedBase(label));
  const stamp = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const brandId = (
    await exec(
      `INSERT INTO brands (workspace_id, name, slug, created_by, is_personal)
       VALUES ($1, $2, $2, $3, false)
       RETURNING id`,
      [b.workspaceId, `brand-${stamp}`, b.actorId]
    )
  ).rows[0].id as string;
  // Make the actor a brand_manager so transitionAsset's permission-aware
  // callers would pass; the helper itself doesn't check, but keeps the
  // fixture realistic.
  await exec(
    `INSERT INTO brand_members (brand_id, user_id, role)
     VALUES ($1, $2, 'brand_manager')
     ON CONFLICT DO NOTHING`,
    [brandId, b.actorId]
  );
  return { ...b, brandId, isPersonal: false };
}

async function seedPersonalBrand(
  label: string,
  base?: BaseSeed
): Promise<PersonalBrandSeed> {
  const b = base ?? (await seedBase(label));
  const stamp = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const brandId = (
    await exec(
      `INSERT INTO brands (workspace_id, name, slug, created_by, is_personal, owner_id)
       VALUES ($1, $2, $2, $3, true, $3)
       RETURNING id`,
      [b.workspaceId, `personal-${stamp}`, b.actorId]
    )
  ).rows[0].id as string;
  return { ...b, brandId, isPersonal: true };
}

async function seedAsset(
  brandSeed: ManagedBrandSeed | PersonalBrandSeed,
  status: "draft" | "in_review" = "draft"
): Promise<string> {
  const [row] = await drizzleDb!
    .insert(assets)
    .values({
      userId: brandSeed.actorId,
      brandId: brandSeed.brandId,
      status,
      source: "uploaded",
      mediaType: "image",
      model: "test-model",
      provider: "test",
      prompt: "test prompt",
      r2Key: `test/${Date.now()}`,
      r2Url: "https://example.test/x",
    })
    .returning({ id: assets.id });
  return row.id;
}

async function cleanupAll() {
  for (const s of seedRefs) {
    try {
      // Cascading FKs evaporate most rows; be explicit on the leaves.
      await exec(`DELETE FROM activity_events WHERE workspace_id = $1`, [
        s.workspaceId,
      ]);
      await exec(`DELETE FROM xp_transactions WHERE user_id = $1`, [s.actorId]);
      await exec(`DELETE FROM user_badges WHERE user_id = $1`, [s.actorId]);
      await exec(`DELETE FROM user_xp WHERE user_id = $1`, [s.actorId]);
      await exec(`DELETE FROM asset_review_log WHERE actor_id = $1`, [s.actorId]);
      await exec(
        `DELETE FROM assets WHERE user_id = $1 AND brand_id IN
           (SELECT id FROM brands WHERE workspace_id = $2)`,
        [s.actorId, s.workspaceId]
      );
      await exec(`DELETE FROM brand_members WHERE user_id = $1`, [s.actorId]);
      await exec(`DELETE FROM brands WHERE workspace_id = $1`, [s.workspaceId]);
      await exec(`DELETE FROM workspace_members WHERE workspace_id = $1`, [
        s.workspaceId,
      ]);
      await exec(`DELETE FROM workspaces WHERE id = $1`, [s.workspaceId]);
      await exec(`DELETE FROM users WHERE id = $1`, [s.actorId]);
    } catch (e) {
      console.warn("cleanup failed:", e);
    }
  }
}

describe.skipIf(!enabled)("US2 — activity emission per verb (T026)", () => {
  beforeAll(async () => {
    if (!enabled) return;
    const r = await exec(
      `SELECT to_regclass('public.activity_events') AS t`
    );
    if (!r.rows[0].t) {
      throw new Error(
        "activity_events table not found — apply migration 0023 first."
      );
    }
  });

  // --------------------------------------------------------------------------
  // 1. generation.created — exercise via emitActivity directly to mirror what
  //    the asset-creation routes do (route handlers are heavy: providers, R2,
  //    auth). The CONTRACT we're locking is "the source-of-truth assets row
  //    plus exactly one matching activity row, with computed visibility".
  // --------------------------------------------------------------------------
  it("generation.created — managed brand → visibility=brand, brand_id set", async () => {
    const seed = await seedManagedBrand("created-brand");
    const assetId = await seedAsset(seed);

    await emitActivity(drizzleDb!, {
      actorId: seed.actorId,
      verb: "generation.created",
      objectType: "asset",
      objectId: assetId,
      workspaceId: seed.workspaceId,
      brandId: seed.brandId,
      visibility: seed.isPersonal ? "private" : "brand",
      metadata: { source: "uploaded", mediaType: "image" },
    });

    const rows = await drizzleDb!
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.objectId, assetId),
          eq(activityEvents.verb, "generation.created")
        )
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].visibility).toBe("brand");
    expect(rows[0].brandId).toBe(seed.brandId);
    expect(rows[0].workspaceId).toBe(seed.workspaceId);
    expect(rows[0].actorId).toBe(seed.actorId);
    expect(rows[0].objectType).toBe("asset");
    expect(rows[0].metadata).toMatchObject({
      source: "uploaded",
      mediaType: "image",
    });
  });

  it("generation.created — personal brand → visibility=private", async () => {
    const seed = await seedPersonalBrand("created-personal");
    const assetId = await seedAsset(seed);

    await emitActivity(drizzleDb!, {
      actorId: seed.actorId,
      verb: "generation.created",
      objectType: "asset",
      objectId: assetId,
      workspaceId: seed.workspaceId,
      brandId: seed.brandId,
      visibility: "private",
      metadata: { source: "generated" },
    });

    const [row] = await drizzleDb!
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.objectId, assetId),
          eq(activityEvents.verb, "generation.created")
        )
      );
    expect(row.visibility).toBe("private");
    expect(row.brandId).toBe(seed.brandId);
  });

  // --------------------------------------------------------------------------
  // 2-4. submit / approve / reject — all flow through transitionAsset(), which
  //      emits the matching verb inline.
  // --------------------------------------------------------------------------
  it("generation.submitted — transitionAsset(submit) emits one row", async () => {
    const seed = await seedManagedBrand("submitted");
    const assetId = await seedAsset(seed, "draft");

    await transitionAsset({
      assetId,
      actorId: seed.actorId,
      action: "submit",
    });

    const rows = await drizzleDb!
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.objectId, assetId));
    expect(rows).toHaveLength(1);
    expect(rows[0].verb).toBe("generation.submitted");
    expect(rows[0].visibility).toBe("brand");
    expect(rows[0].brandId).toBe(seed.brandId);
    expect(rows[0].workspaceId).toBe(seed.workspaceId);
    expect(rows[0].metadata).toMatchObject({
      fromStatus: "draft",
      toStatus: "in_review",
    });
  });

  it("generation.approved — transitionAsset(approve) emits one row", async () => {
    const seed = await seedManagedBrand("approved");
    const assetId = await seedAsset(seed, "in_review");

    await transitionAsset({
      assetId,
      actorId: seed.actorId,
      action: "approve",
    });

    const rows = await drizzleDb!
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.objectId, assetId));
    expect(rows).toHaveLength(1);
    expect(rows[0].verb).toBe("generation.approved");
    expect(rows[0].visibility).toBe("brand");
    expect(rows[0].metadata).toMatchObject({ toStatus: "approved" });
  });

  it("generation.rejected — transitionAsset(reject) carries the note in metadata", async () => {
    const seed = await seedManagedBrand("rejected");
    const assetId = await seedAsset(seed, "in_review");

    await transitionAsset({
      assetId,
      actorId: seed.actorId,
      action: "reject",
      note: "off-brand color palette",
    });

    const rows = await drizzleDb!
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.objectId, assetId));
    expect(rows).toHaveLength(1);
    expect(rows[0].verb).toBe("generation.rejected");
    expect(rows[0].visibility).toBe("brand");
    expect(rows[0].metadata).toMatchObject({
      toStatus: "rejected",
      note: "off-brand color palette",
    });
  });

  // --------------------------------------------------------------------------
  // 5. generation.completed — emitActivity inline, mirrors the routes.
  // --------------------------------------------------------------------------
  it("generation.completed — visibility mirrors the asset's brand", async () => {
    const seed = await seedManagedBrand("completed");
    const assetId = await seedAsset(seed);

    // Stand-in for the generations row that the routes flip to 'completed'.
    const [gen] = await drizzleDb!
      .insert(generations)
      .values({
        userId: seed.actorId,
        model: "test",
        prompt: "test",
        status: "completed",
        assetId,
      })
      .returning({ id: generations.id });

    await emitActivity(drizzleDb!, {
      actorId: seed.actorId,
      verb: "generation.completed",
      objectType: "generation",
      objectId: gen.id,
      workspaceId: seed.workspaceId,
      brandId: seed.brandId,
      visibility: seed.isPersonal ? "private" : "brand",
      metadata: { mediaType: "image", model: "test", assetId, durationMs: 1234 },
    });

    const rows = await drizzleDb!
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.objectId, gen.id),
          eq(activityEvents.verb, "generation.completed")
        )
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].visibility).toBe("brand");
    expect(rows[0].objectType).toBe("generation");
    expect(rows[0].metadata).toMatchObject({
      mediaType: "image",
      model: "test",
      assetId,
      durationMs: 1234,
    });
  });

  // --------------------------------------------------------------------------
  // 6. member.earned_feat — awardBadge emits, visibility=workspace, brand_id null.
  //    We exercise via `checkAndAwardBadges` against a state where the user
  //    has 1 completed generation → they qualify for `first-brew`.
  // --------------------------------------------------------------------------
  it("member.earned_feat — awardBadge emits one workspace-scoped row", async () => {
    const seed = await seedBase("earned-feat");

    // Seed one completed generation so first-brew qualifies.
    await drizzleDb!.insert(generations).values({
      userId: seed.actorId,
      model: "test",
      prompt: "test",
      status: "completed",
    });

    const earned = await checkAndAwardBadges(seed.actorId, seed.workspaceId);
    const firstBrew = earned.find((b) => b.badgeId === "first-brew");
    expect(firstBrew).toBeDefined();

    const rows = await drizzleDb!
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.actorId, seed.actorId),
          eq(activityEvents.verb, "member.earned_feat")
        )
      );
    // checkAndAwardBadges may award multiple feats if other criteria coincide;
    // assert AT LEAST one with the correct shape and that 'first-brew' is in
    // the set.
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const featRow = rows.find(
      (r) => (r.metadata as Record<string, unknown>).feat === "first-brew"
    );
    expect(featRow).toBeDefined();
    expect(featRow!.visibility).toBe("workspace");
    expect(featRow!.brandId).toBeNull();
    expect(featRow!.workspaceId).toBe(seed.workspaceId);
    expect(featRow!.objectType).toBe("feat");
    expect(featRow!.metadata).toMatchObject({
      feat: "first-brew",
      name: "First Brew",
      icon: "FlaskConical",
    });
  });

  // --------------------------------------------------------------------------
  // 7. member.leveled_up — awardXP emits when crossing a level threshold.
  //    Level 1 → 2 happens at 50 XP; we award 60 to clear the boundary.
  // --------------------------------------------------------------------------
  it("member.leveled_up — awardXP emits one row with new level + title", async () => {
    const seed = await seedBase("leveled-up");

    // Ensure user_xp exists at level 1 / xp 0 baseline.
    const startResult = await awardXP(
      seed.actorId,
      60, // crosses 50 → level 2 ('Herbalist')
      "admin_grant",
      "test seed",
      undefined,
      seed.workspaceId
    );
    expect(startResult.leveledUp).toBe(true);
    expect(startResult.newLevel).toBe(2);

    const rows = await drizzleDb!
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.actorId, seed.actorId),
          eq(activityEvents.verb, "member.leveled_up")
        )
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].visibility).toBe("workspace");
    expect(rows[0].brandId).toBeNull();
    expect(rows[0].workspaceId).toBe(seed.workspaceId);
    expect(rows[0].objectType).toBe("user");
    expect(rows[0].objectId).toBe(seed.actorId);
    expect(rows[0].metadata).toMatchObject({
      level: 2,
      title: "Herbalist",
    });
  });

  it("member.leveled_up — does NOT emit when no threshold crossed", async () => {
    const seed = await seedBase("no-level");

    // Below the level-2 threshold — no leveled_up event.
    const r = await awardXP(
      seed.actorId,
      10,
      "generation",
      "small grant",
      undefined,
      seed.workspaceId
    );
    expect(r.leveledUp).toBe(false);

    const rows = await drizzleDb!
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.actorId, seed.actorId),
          eq(activityEvents.verb, "member.leveled_up")
        )
      );
    expect(rows).toHaveLength(0);
  });
});

describe.skipIf(!enabled)("US2 — rollback safety (T027)", () => {
  it("forced error after emit inside a tx → no row written", async () => {
    const seed = await seedManagedBrand("rollback");

    const sentinel = `rollback-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    await expect(
      drizzleDb!.transaction(async (tx) => {
        await emitActivity(tx, {
          actorId: seed.actorId,
          verb: "generation.created",
          objectType: "asset",
          objectId: seed.brandId, // any uuid
          workspaceId: seed.workspaceId,
          brandId: seed.brandId,
          visibility: "brand",
          metadata: { sentinel },
        });
        // Force the tx to roll back AFTER the emit.
        throw new Error("simulated downstream failure");
      })
    ).rejects.toThrow(/simulated/);

    const [{ count }] = await drizzleDb!
      .select({ count: sql<number>`count(*)::int` })
      .from(activityEvents)
      .where(sql`${activityEvents.metadata}->>'sentinel' = ${sentinel}`);
    expect(count).toBe(0);
  });
});

describe.skipIf(!enabled)(
  "US2 — visibility broadening keeps the prior row (T028)",
  () => {
    it("private generation.created stays unchanged when later submitted with brand visibility", async () => {
      // Seed: a personal-brand asset that emits a `private generation.created`,
      // then is reassigned to a managed brand AND submitted (which emits a
      // fresh `brand generation.submitted`). The original row MUST survive
      // unmutated.
      const personal = await seedPersonalBrand("broaden-personal");
      const managed = await seedManagedBrand("broaden-managed", personal);

      // Step 1 — create on personal brand.
      const assetId = await seedAsset(personal, "draft");
      await emitActivity(drizzleDb!, {
        actorId: personal.actorId,
        verb: "generation.created",
        objectType: "asset",
        objectId: assetId,
        workspaceId: personal.workspaceId,
        brandId: personal.brandId,
        visibility: "private",
        metadata: { source: "generated" },
      });

      // Snapshot the private row's id+createdAt so we can prove it was never
      // touched.
      const [originalRow] = await drizzleDb!
        .select()
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.objectId, assetId),
            eq(activityEvents.verb, "generation.created")
          )
        );
      expect(originalRow.visibility).toBe("private");
      const originalId = originalRow.id;
      const originalCreatedAt = originalRow.createdAt;

      // Step 2 — reassign the asset to the managed brand and submit. The
      // route layer would do this in two steps; we just rewrite assets.brand_id
      // to mirror the post-reassign state.
      await drizzleDb!
        .update(assets)
        .set({ brandId: managed.brandId })
        .where(eq(assets.id, assetId));

      await transitionAsset({
        assetId,
        actorId: managed.actorId,
        action: "submit",
      });

      // Both rows now exist on the same asset.
      const all = await drizzleDb!
        .select()
        .from(activityEvents)
        .where(eq(activityEvents.objectId, assetId));
      expect(all).toHaveLength(2);

      const created = all.find((r) => r.verb === "generation.created")!;
      const submitted = all.find((r) => r.verb === "generation.submitted")!;
      expect(created).toBeDefined();
      expect(submitted).toBeDefined();

      // Original row is byte-for-byte untouched (FR-001 append-only).
      expect(created.id).toBe(originalId);
      expect(created.visibility).toBe("private");
      expect(created.brandId).toBe(personal.brandId);
      expect(created.createdAt.getTime()).toBe(originalCreatedAt.getTime());

      // The new row is a separate row with the broadened scope.
      expect(submitted.id).not.toBe(originalId);
      expect(submitted.visibility).toBe("brand");
      expect(submitted.brandId).toBe(managed.brandId);
    });
  }
);

// Suppress "unused" warning for getLevelFromXP — keeps the import meaningful
// as documentation of the level-curve dependency the test relies on.
void getLevelFromXP;
void userBadges;
void userXp;
void xpTransactions;

// Global teardown — share state across all three describe blocks. Vitest
// runs top-level `afterAll` hooks once after every nested suite completes.
describe.skipIf(!enabled)("US2 — teardown", () => {
  afterAll(async () => {
    await cleanupAll();
    await setupPool?.end();
    await neonPool?.end();
  });
  it("placeholder — keeps the suite from being empty", () => {
    expect(true).toBe(true);
  });
});
