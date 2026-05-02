/**
 * `emitActivity()` integration tests (T015).
 *
 * Gated on `INTEGRATION_DATABASE_URL`. Run by setting the env var to a
 * disposable Postgres (Neon dev branch or local docker) where migration
 * 0023 has been applied. Each test seeds its own user/workspace/brand so
 * isolation is fixture-local; we clean up at the end of the suite.
 *
 * Coverage (per spec / kickoff):
 *   1. Insert success — round-trip a row, read it back, verify all fields.
 *   2. Visibility — `private | brand | workspace` each produces a row with
 *      that exact stored value.
 *   3. FK violation — passing a non-existent workspace_id surfaces a clean
 *      Postgres error (not a silent no-op).
 *   4. Rolled-back tx — when the parent tx throws, NO row is written.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import dotenv from "dotenv";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { eq, sql } from "drizzle-orm";
import { activityEvents } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";
import { emitActivity } from "@/lib/activity";

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

interface Seed {
  workspaceId: string;
  brandId: string;
  actorId: string;
}

async function seed(label: string): Promise<Seed> {
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

  const brandId = (
    await exec(
      `INSERT INTO brands (workspace_id, name, slug, created_by)
       VALUES ($1, $2, $2, $3)
       RETURNING id`,
      [workspaceId, `brand-${stamp}`, actorId]
    )
  ).rows[0].id as string;

  return { workspaceId, brandId, actorId };
}

async function cleanup(seedRef: Seed) {
  // Delete in reverse FK order. activity_events.brand_id is ON DELETE SET NULL
  // and workspace_id is ON DELETE CASCADE, so dropping the workspace evaporates
  // the rest, but be explicit for safety.
  await exec(`DELETE FROM activity_events WHERE workspace_id = $1`, [
    seedRef.workspaceId,
  ]);
  await exec(`DELETE FROM brand_members WHERE brand_id = $1`, [seedRef.brandId]);
  await exec(`DELETE FROM brands WHERE id = $1`, [seedRef.brandId]);
  await exec(`DELETE FROM workspace_members WHERE workspace_id = $1`, [
    seedRef.workspaceId,
  ]);
  await exec(`DELETE FROM workspaces WHERE id = $1`, [seedRef.workspaceId]);
  await exec(`DELETE FROM users WHERE id = $1`, [seedRef.actorId]);
}

describe.skipIf(!enabled)("emitActivity()", () => {
  const seedsToCleanup: Seed[] = [];

  beforeAll(async () => {
    if (!enabled) return;
    // Sanity: table must exist.
    const r = await exec(
      `SELECT to_regclass('public.activity_events') AS t`
    );
    if (!r.rows[0].t) {
      throw new Error(
        "activity_events table not found — apply migration 0023 first."
      );
    }
  });

  afterAll(async () => {
    for (const s of seedsToCleanup) {
      try {
        await cleanup(s);
      } catch (e) {
        // best effort
        console.warn("cleanup failed:", e);
      }
    }
    await setupPool?.end();
    await neonPool?.end();
  });

  it("inserts a single row with all fields round-tripped", async () => {
    const s = await seed("insert");
    seedsToCleanup.push(s);

    const objectId = s.brandId; // any uuid will do; brand makes a valid string
    const result = await emitActivity(drizzleDb!, {
      actorId: s.actorId,
      verb: "generation.created",
      objectType: "asset",
      objectId,
      workspaceId: s.workspaceId,
      brandId: s.brandId,
      visibility: "brand",
      metadata: { hello: "world", n: 42 },
    });

    expect(result.id).toMatch(/^[0-9a-f-]{36}$/i);

    const rows = await drizzleDb!
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.id, result.id));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.actorId).toBe(s.actorId);
    expect(row.verb).toBe("generation.created");
    expect(row.objectType).toBe("asset");
    expect(row.objectId).toBe(objectId);
    expect(row.workspaceId).toBe(s.workspaceId);
    expect(row.brandId).toBe(s.brandId);
    expect(row.visibility).toBe("brand");
    expect(row.metadata).toEqual({ hello: "world", n: 42 });
    expect(row.backfillKey).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it.each(["private", "brand", "workspace"] as const)(
    "stores visibility=%s exactly as passed",
    async (visibility) => {
      const s = await seed(`vis-${visibility}`);
      seedsToCleanup.push(s);

      const result = await emitActivity(drizzleDb!, {
        actorId: s.actorId,
        verb: "generation.created",
        objectType: "asset",
        objectId: s.brandId,
        workspaceId: s.workspaceId,
        // brandId omitted for workspace; included for the others to mirror real usage
        brandId: visibility === "workspace" ? null : s.brandId,
        visibility,
      });

      const [row] = await drizzleDb!
        .select({ visibility: activityEvents.visibility })
        .from(activityEvents)
        .where(eq(activityEvents.id, result.id));
      expect(row.visibility).toBe(visibility);
    }
  );

  it("surfaces a clean FK error when workspace_id does not exist", async () => {
    const s = await seed("fk");
    seedsToCleanup.push(s);

    const fakeWorkspaceId = "00000000-0000-0000-0000-000000000000";
    await expect(
      emitActivity(drizzleDb!, {
        actorId: s.actorId,
        verb: "generation.created",
        objectType: "asset",
        objectId: s.brandId,
        workspaceId: fakeWorkspaceId,
        brandId: null,
        visibility: "workspace",
      })
    ).rejects.toThrow(/foreign key|workspace/i);
  });

  it("writes no row when the parent transaction rolls back", async () => {
    const s = await seed("rollback");
    seedsToCleanup.push(s);

    const sentinel = `rollback-sentinel-${Date.now()}`;

    await expect(
      drizzleDb!.transaction(async (tx) => {
        await emitActivity(tx, {
          actorId: s.actorId,
          verb: "generation.created",
          objectType: "asset",
          objectId: s.brandId,
          workspaceId: s.workspaceId,
          brandId: s.brandId,
          visibility: "brand",
          metadata: { sentinel },
        });
        // Force the tx to roll back AFTER the insert.
        throw new Error("boom — forcing rollback");
      })
    ).rejects.toThrow(/boom/);

    const [{ count }] = await drizzleDb!
      .select({ count: sql<number>`count(*)::int` })
      .from(activityEvents)
      .where(sql`${activityEvents.metadata}->>'sentinel' = ${sentinel}`);
    expect(count).toBe(0);
  });
});
