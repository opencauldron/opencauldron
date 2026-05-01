/**
 * GET /api/threads/by-asset/[assetId] — fetch the thread for an asset
 * (lazy-creating the row on first hit) plus the latest 50 messages,
 * fully hydrated.
 *
 * Auth: signed-in workspace member of the asset's workspace.
 * Flag : 404 when `THREADS_ENABLED=false`.
 *
 * Lazy-create pattern: `INSERT ... ON CONFLICT (asset_id) DO NOTHING
 * RETURNING ...` — if the row already exists, the RETURNING clause is
 * empty so we follow up with a SELECT. Single round trip in the
 * hot-path "thread already exists".
 */

import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { assetThreads, messages } from "@/lib/db/schema";
import {
  PermissionError,
  assertWorkspaceMemberForAsset,
} from "@/lib/threads/permissions";
import { hydrateMessages, type MessageRow } from "@/lib/threads/hydrate";

const HYDRATE_LIMIT = 50;

function flagOff(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  if (!env.THREADS_ENABLED) return flagOff();

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { assetId } = await params;

  let perm;
  try {
    perm = await assertWorkspaceMemberForAsset(userId, assetId);
  } catch (err) {
    if (err instanceof PermissionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  // Lazy-create. ON CONFLICT (asset_id) DO NOTHING returns no row when the
  // thread already exists, so we fall back to a SELECT.
  const inserted = await db
    .insert(assetThreads)
    .values({
      assetId,
      workspaceId: perm.workspaceId,
    })
    .onConflictDoNothing({ target: assetThreads.assetId })
    .returning();

  let thread = inserted[0];
  if (!thread) {
    const existing = await db
      .select()
      .from(assetThreads)
      .where(eq(assetThreads.assetId, assetId))
      .limit(1);
    thread = existing[0];
  }
  if (!thread) {
    // Race that we lost AND the row vanished — practically impossible, but
    // surface a 500 rather than throw.
    return NextResponse.json(
      { error: "thread_create_failed" },
      { status: 500 }
    );
  }

  // Latest 50 (newest first by `created_at desc, id desc`). Soft-deleted
  // messages are kept (the spec calls for tombstones to render, and reply
  // chains need them to resolve).
  const latestRaw = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, thread.id))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(HYDRATE_LIMIT);

  const latest = latestRaw as MessageRow[];
  const hydrated = await hydrateMessages(latest, userId);

  return NextResponse.json({
    thread: {
      id: thread.id,
      assetId: thread.assetId,
      workspaceId: thread.workspaceId,
      messageCount: thread.messageCount,
      lastMessageAt: thread.lastMessageAt,
      createdAt: thread.createdAt,
    },
    // Reverse for client convenience — UI renders oldest-at-top.
    messages: hydrated.reverse(),
    nextCursor:
      hydrated.length === HYDRATE_LIMIT && hydrated[0]
        ? `${hydrated[0].createdAt.toISOString()}__${hydrated[0].id}`
        : null,
  });
}
