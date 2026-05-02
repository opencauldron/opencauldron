/**
 * POST /api/threads/[id]/messages/[messageId]/reactions
 *
 * Body: { emoji: string }
 *
 * Toggles a reaction. Implementation:
 *   1. INSERT ... ON CONFLICT DO NOTHING RETURNING — if a row comes back,
 *      it's a freshly added reaction (`delta: '+1'`).
 *   2. If the insert was a no-op (PK collision), DELETE the existing row
 *      (`delta: '-1'`).
 *
 * Both paths fire `pg_notify` with `kind: 'reaction.toggled'`. Rate-limited
 * via the same per-(user, thread) bucket as message creates so reaction
 * spam can't blow past NFR-004.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withThreadTransaction } from "@/lib/db/tx";
import { env } from "@/lib/env";
import { messageReactions, messages } from "@/lib/db/schema";
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

const postSchema = z.object({
  emoji: z.string().min(1).max(64),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: threadId, messageId } = await params;
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

  // Reactions get a dedicated bucket + 30/min ceiling per NFR-004. The
  // `bucket: "reaction"` separator means message-creates and reactions don't
  // share the same per-minute count — a chatty user can both type and react
  // up to their respective ceilings.
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

  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await req.json());
  } catch (err) {
    finishLog("rejected", {
      details: { reason: "invalid_body", workspaceId: perm.workspaceId },
    });
    return NextResponse.json(
      {
        error: "invalid_body",
        details: err instanceof z.ZodError ? err.flatten() : undefined,
      },
      { status: 400 }
    );
  }

  // Confirm the message belongs to this thread (defense-in-depth).
  const msgRow = await db
    .select({
      threadId: messages.threadId,
      deletedAt: messages.deletedAt,
    })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  const msg = msgRow[0];
  if (!msg || msg.threadId !== threadId) {
    finishLog("rejected", {
      details: { reason: "message_not_found", workspaceId: perm.workspaceId },
    });
    return NextResponse.json({ error: "message_not_found" }, { status: 404 });
  }
  if (msg.deletedAt) {
    finishLog("rejected", {
      details: { reason: "message_deleted", workspaceId: perm.workspaceId },
    });
    return NextResponse.json({ error: "message_deleted" }, { status: 410 });
  }

  let result: { delta: "+1" | "-1"; eventId: string };
  try {
    result = await withThreadTransaction(async (tx) => {
    const inserted = await tx
      .insert(messageReactions)
      .values({
        messageId,
        userId,
        emoji: body.emoji,
      })
      .onConflictDoNothing()
      .returning();

    let delta: "+1" | "-1";
    if (inserted.length > 0) {
      delta = "+1";
    } else {
      // Toggle off — delete the existing row.
      await tx
        .delete(messageReactions)
        .where(
          and(
            eq(messageReactions.messageId, messageId),
            eq(messageReactions.userId, userId),
            eq(messageReactions.emoji, body.emoji)
          )
        );
      delta = "-1";
    }

    const eventId = randomUUID();
    await pgNotifyThreadEvent(
      {
        threadId,
        kind: "reaction.toggled",
        messageId,
        actorId: userId,
        eventId,
        emoji: body.emoji,
        delta,
      },
      tx
    );
    return { delta, eventId };
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
      emoji: body.emoji,
      delta: result.delta,
    },
  });

  return NextResponse.json({
    ok: true,
    delta: result.delta,
    eventId: result.eventId,
  });
}
