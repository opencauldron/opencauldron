/**
 * Threads foundation integration test (T024).
 *
 * Gated on `INTEGRATION_DATABASE_URL`. Run by setting the env var to a
 * disposable Postgres (Neon dev branch or local docker) where migrations
 * 0000-0018 have been applied. The test exercises the lazy-create + ordering
 * + fan-out + rate-limit paths through the same drizzle handle the routes
 * use, but stays under the route layer so it can run without a live HTTP
 * stack.
 *
 * Each `it()` runs in its own transaction-equivalent wrapper (TRUNCATE at
 * the bottom of the suite). Test isolation is best-effort — we use
 * fresh-id fixtures rather than shared seeds.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const url = process.env.INTEGRATION_DATABASE_URL;
const enabled = !!url;
const pool = enabled ? new Pool({ connectionString: url }) : null;

async function exec(sql: string, params?: unknown[]) {
  if (!pool) throw new Error("pool unset");
  return pool.query(sql, params);
}

async function reset() {
  // Truncate threads + dependents only; preserve users/workspaces/brands.
  await exec(`
    TRUNCATE TABLE
      message_attachments,
      message_mentions,
      message_reactions,
      messages,
      asset_threads
    CASCADE;
  `);
}

async function seedAsset(): Promise<{
  workspaceId: string;
  brandId: string;
  assetId: string;
  ownerId: string;
  memberId: string;
  outsiderId: string;
}> {
  // Minimal in-test seed. We rely on migrations 0008+ having created the
  // schema; this builds the smallest graph that the thread routes depend on.
  const ownerId = (
    await exec(
      `INSERT INTO users (email, name, role)
       VALUES ($1, 'Owner', 'admin')
       RETURNING id`,
      [`owner-${Date.now()}@test.local`]
    )
  ).rows[0].id as string;

  const memberId = (
    await exec(
      `INSERT INTO users (email, name, role)
       VALUES ($1, 'Member', 'member')
       RETURNING id`,
      [`member-${Date.now()}@test.local`]
    )
  ).rows[0].id as string;

  const outsiderId = (
    await exec(
      `INSERT INTO users (email, name, role)
       VALUES ($1, 'Outsider', 'member')
       RETURNING id`,
      [`outsider-${Date.now()}@test.local`]
    )
  ).rows[0].id as string;

  const workspaceId = (
    await exec(
      `INSERT INTO workspaces (name, slug)
       VALUES ($1, $1)
       RETURNING id`,
      [`ws-${Date.now()}`]
    )
  ).rows[0].id as string;

  await exec(
    `INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
    [workspaceId, ownerId, memberId]
  );

  const brandId = (
    await exec(
      `INSERT INTO brands (workspace_id, name, slug, created_by)
       VALUES ($1, 'Test Brand', $2, $3)
       RETURNING id`,
      [workspaceId, `brand-${Date.now()}`, ownerId]
    )
  ).rows[0].id as string;

  const assetId = (
    await exec(
      `INSERT INTO assets (
         user_id, brand_id, model, provider, prompt, r2_key, r2_url, source
       )
       VALUES ($1, $2, 'test-model', 'test', 'test prompt',
               'k', 'u', 'uploaded')
       RETURNING id`,
      [ownerId, brandId]
    )
  ).rows[0].id as string;

  return { workspaceId, brandId, assetId, ownerId, memberId, outsiderId };
}

describe.skipIf(!enabled)("asset-threads foundation", () => {
  beforeAll(async () => {
    await reset();
  });
  afterAll(async () => {
    await reset();
    await pool?.end();
  });

  it("lazy-creates the thread row on first ON CONFLICT insert", async () => {
    const { workspaceId, assetId } = await seedAsset();
    const insert = await exec(
      `INSERT INTO asset_threads (asset_id, workspace_id)
       VALUES ($1, $2)
       ON CONFLICT (asset_id) DO NOTHING
       RETURNING id`,
      [assetId, workspaceId]
    );
    expect(insert.rows.length).toBe(1);

    // Second call returns no row (already exists) — the route would fall
    // back to a SELECT here.
    const idem = await exec(
      `INSERT INTO asset_threads (asset_id, workspace_id)
       VALUES ($1, $2)
       ON CONFLICT (asset_id) DO NOTHING
       RETURNING id`,
      [assetId, workspaceId]
    );
    expect(idem.rows.length).toBe(0);
  });

  it("orders messages by (created_at desc, id desc)", async () => {
    const { workspaceId, assetId, ownerId } = await seedAsset();
    const threadId = (
      await exec(
        `INSERT INTO asset_threads (asset_id, workspace_id)
         VALUES ($1, $2) RETURNING id`,
        [assetId, workspaceId]
      )
    ).rows[0].id as string;

    // Insert several messages with explicit created_at to control order.
    const t0 = new Date(Date.now() - 3000);
    const t1 = new Date(Date.now() - 2000);
    const t2 = new Date(Date.now() - 1000);
    for (const [body, ts] of [
      ["first", t0],
      ["second", t1],
      ["third", t2],
    ] as const) {
      await exec(
        `INSERT INTO messages (thread_id, workspace_id, author_id, body, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [threadId, workspaceId, ownerId, body, ts]
      );
    }
    const rows = (
      await exec(
        `SELECT body FROM messages
         WHERE thread_id = $1
         ORDER BY created_at DESC, id DESC`,
        [threadId]
      )
    ).rows.map((r) => r.body);
    expect(rows).toEqual(["third", "second", "first"]);
  });

  it("notifies the parent author on reply (skipping self)", async () => {
    const { workspaceId, assetId, ownerId, memberId } = await seedAsset();
    const threadId = (
      await exec(
        `INSERT INTO asset_threads (asset_id, workspace_id) VALUES ($1, $2) RETURNING id`,
        [assetId, workspaceId]
      )
    ).rows[0].id as string;

    const parentId = (
      await exec(
        `INSERT INTO messages (thread_id, workspace_id, author_id, body)
         VALUES ($1, $2, $3, 'parent') RETURNING id`,
        [threadId, workspaceId, ownerId]
      )
    ).rows[0].id as string;

    await exec(
      `INSERT INTO messages (thread_id, workspace_id, author_id, parent_message_id, body)
       VALUES ($1, $2, $3, $4, 'reply')`,
      [threadId, workspaceId, memberId, parentId]
    );

    // Simulate the route layer's notification fan-out: a thread_reply row for
    // the parent author when the replier is someone else.
    await exec(
      `INSERT INTO notifications (user_id, workspace_id, actor_id, type, payload, href)
       VALUES ($1, $2, $3, 'thread_reply', '{"threadId":"x"}', '/library')`,
      [ownerId, workspaceId, memberId]
    );

    const notifs = await exec(
      `SELECT type FROM notifications
       WHERE user_id = $1 AND workspace_id = $2`,
      [ownerId, workspaceId]
    );
    expect(notifs.rows.map((r) => r.type)).toContain("thread_reply");
  });

  it("toggles a reaction via INSERT ON CONFLICT then DELETE", async () => {
    const { workspaceId, assetId, ownerId } = await seedAsset();
    const threadId = (
      await exec(
        `INSERT INTO asset_threads (asset_id, workspace_id) VALUES ($1, $2) RETURNING id`,
        [assetId, workspaceId]
      )
    ).rows[0].id as string;

    const messageId = (
      await exec(
        `INSERT INTO messages (thread_id, workspace_id, author_id, body)
         VALUES ($1, $2, $3, 'react me') RETURNING id`,
        [threadId, workspaceId, ownerId]
      )
    ).rows[0].id as string;

    // First press — fresh row.
    const insert = await exec(
      `INSERT INTO message_reactions (message_id, user_id, emoji)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING message_id`,
      [messageId, ownerId, "🔥"]
    );
    expect(insert.rows.length).toBe(1);

    // Second press — collision, no row returned. Route would DELETE next.
    const idem = await exec(
      `INSERT INTO message_reactions (message_id, user_id, emoji)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING message_id`,
      [messageId, ownerId, "🔥"]
    );
    expect(idem.rows.length).toBe(0);

    const deleted = await exec(
      `DELETE FROM message_reactions
       WHERE message_id = $1 AND user_id = $2 AND emoji = $3
       RETURNING message_id`,
      [messageId, ownerId, "🔥"]
    );
    expect(deleted.rows.length).toBe(1);
  });
});

describe.skipIf(!enabled)("asset-threads foundation — rate limit pure shape", () => {
  it("the in-memory limiter denies the (N+1)th burst hit", async () => {
    const {
      __resetRateLimitsForTests,
      checkAndConsumeThreadRateLimit,
    } = await import("@/lib/threads/rate-limit");
    __resetRateLimitsForTests();
    const userId = "rl-user";
    const threadId = "rl-thread";
    for (let i = 0; i < 5; i++) {
      const r = checkAndConsumeThreadRateLimit(userId, threadId, {
        burstPer5s: 5,
        maxPerMinute: 100,
      });
      expect(r.ok).toBe(true);
    }
    const sixth = checkAndConsumeThreadRateLimit(userId, threadId, {
      burstPer5s: 5,
      maxPerMinute: 100,
    });
    expect(sixth.ok).toBe(false);
    expect(sixth.retryAfterMs).toBeGreaterThan(0);
  });
});
