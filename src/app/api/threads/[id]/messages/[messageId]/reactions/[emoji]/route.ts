/**
 * DELETE /api/threads/[id]/messages/[messageId]/reactions/[emoji]
 *
 * Explicit remove path — keyboard-accessible alternative to the POST toggle.
 * If the reaction doesn't exist, returns 200 + `removed: false` (idempotent).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withThreadTransaction } from "@/lib/db/tx";
import { env } from "@/lib/env";
import { messageReactions } from "@/lib/db/schema";
import {
  PermissionError,
  assertWorkspaceMemberForThread,
} from "@/lib/threads/permissions";
import { checkAndConsumeThreadRateLimit } from "@/lib/threads/rate-limit";
import { pgNotifyThreadEvent } from "@/lib/threads/notify";
import {
  extractSqlState,
  startThreadTimer,
} from "@/lib/threads/telemetry";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; messageId: string; emoji: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: threadId, messageId, emoji } = await params;
  const decodedEmoji = decodeURIComponent(emoji);
  const finishLog = startThreadTimer({
    event: "reaction.toggle",
    threadId,
    userId,
    workspaceId: null,
  });

  let perm;
  try {
    perm = await assertWorkspaceMemberForThread(userId, threadId);
  } catch (err) {
    if (err instanceof PermissionError) {
      finishLog("rejected", { details: { reason: "permission", status: err.status } });
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    finishLog("error", { error: extractSqlState(err) });
    throw err;
  }

  // Same bucket as POST reactions so a paired toggle (POST then DELETE) only
  // double-counts when the user is actually doing two distinct actions.
  const rl = checkAndConsumeThreadRateLimit(userId, threadId, {
    maxPerMinute: env.THREAD_REACTION_RATE_LIMIT_MAX_PER_MIN,
    bucket: "reaction",
  });
  if (!rl.ok) {
    finishLog("rate_limited", {
      details: {
        workspaceId: perm.workspaceId,
        retryAfterMs: rl.retryAfterMs,
      },
    });
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: rl.retryAfterMs },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      }
    );
  }

  let result: { removed: boolean; eventId: string | null };
  try {
    result = await withThreadTransaction(async (tx) => {
    const deleted = await tx
      .delete(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, messageId),
          eq(messageReactions.userId, userId),
          eq(messageReactions.emoji, decodedEmoji)
        )
      )
      .returning();

    if (deleted.length === 0) {
      return { removed: false, eventId: null as string | null };
    }

    const eventId = randomUUID();
    await pgNotifyThreadEvent(
      {
        threadId,
        kind: "reaction.toggled",
        messageId,
        actorId: userId,
        eventId,
        emoji: decodedEmoji,
        delta: "-1",
      },
      tx
    );
    return { removed: true, eventId };
  });
  } catch (err) {
    finishLog("error", {
      details: { workspaceId: perm.workspaceId, stage: "transaction" },
      error: extractSqlState(err),
    });
    throw err;
  }

  finishLog("ok", {
    details: {
      workspaceId: perm.workspaceId,
      messageId,
      emoji: decodedEmoji,
      delta: "-1",
      removed: result.removed,
    },
  });

  return NextResponse.json({ ok: true, ...result });
}
