/**
 * /api/threads/[id]/messages/[messageId] — edit + delete a message.
 *
 * PATCH  body: { body }                 — author-only edit (T017).
 * DELETE                                — soft-delete (own OR moderator) (T018).
 *
 * Both fire `pg_notify` with the appropriate event kind. PATCH re-runs
 * mention extraction and writes notifications ONLY for newly-mentioned
 * users (the diff against existing `message_mentions`). DELETE scrubs
 * `body` to `null` and sets `deleted_at`.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withThreadTransaction } from "@/lib/db/tx";
import { env } from "@/lib/env";
import {
  messageMentions,
  messages,
} from "@/lib/db/schema";
import {
  PermissionError,
  assertWorkspaceMemberForThread,
  canModerate,
} from "@/lib/threads/permissions";
import { parseBody, type BodyMember } from "@/lib/threads/body-parse";
import {
  isMentionableInWorkspace,
  resolveWorkspaceMembersForMention,
} from "@/lib/threads/resolve-mentions";
import { pgNotifyThreadEvent } from "@/lib/threads/notify";
import {
  extractSqlState,
  startThreadTimer,
} from "@/lib/threads/telemetry";
import { hydrateMessages, type MessageRow } from "@/lib/threads/hydrate";
import { createNotification } from "@/lib/notifications";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

const MAX_BODY_LEN = 4000;

function flagOff(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

const patchSchema = z.object({
  body: z.string().min(1).max(MAX_BODY_LEN),
});

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  if (!env.THREADS_ENABLED) return flagOff();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: threadId, messageId } = await params;
  const finishLog = startThreadTimer({
    event: "message.update",
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

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
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

  const existing = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  const msg = existing[0];
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
  if (msg.authorId !== userId && !canModerate(perm.role)) {
    finishLog("rejected", {
      details: { reason: "forbidden", workspaceId: perm.workspaceId },
    });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Diff mentions — only NEW mentions get notifications.
  const members: BodyMember[] = (
    await resolveWorkspaceMembersForMention(perm.workspaceId)
  ).map((m) => ({ id: m.id, displayName: m.displayName, handle: m.handle }));
  const parsed = parseBody(body.body, members);

  const previousMentionRows = await db
    .select({ mentionedUserId: messageMentions.mentionedUserId })
    .from(messageMentions)
    .where(eq(messageMentions.messageId, messageId));
  const previouslyMentioned = new Set(
    previousMentionRows.map((r) => r.mentionedUserId)
  );
  const newMentions = parsed.mentions.filter(
    (m) => !previouslyMentioned.has(m.userId) && m.userId !== userId
  );

  let editResult: { updated: typeof messages.$inferSelect; eventId: string };
  try {
    editResult = await withThreadTransaction(async (tx) => {
    const now = new Date();
    const [updated] = await tx
      .update(messages)
      .set({ body: body.body, editedAt: now })
      .where(eq(messages.id, messageId))
      .returning();

    // Replace mentions: delete-then-insert is simplest; the table is tiny.
    await tx
      .delete(messageMentions)
      .where(eq(messageMentions.messageId, messageId));
    if (parsed.mentions.length > 0) {
      await tx
        .insert(messageMentions)
        .values(
          parsed.mentions.map((m) => ({
            messageId,
            mentionedUserId: m.userId,
          }))
        )
        .onConflictDoNothing();
    }

    const eventId = randomUUID();
    await pgNotifyThreadEvent(
      {
        threadId,
        kind: "message.updated",
        messageId,
        actorId: userId,
        eventId,
      },
      tx
    );
    return { updated, eventId };
  });
  } catch (err) {
    finishLog("error", {
      details: { workspaceId: perm.workspaceId, stage: "transaction" },
      error: extractSqlState(err),
    });
    throw err;
  }

  // Notifications for newly-mentioned users only.
  await Promise.all(
    newMentions.map(async (m) => {
      const ok = await isMentionableInWorkspace(perm.workspaceId, m.userId);
      if (!ok) return;
      await createNotification({
        userId: m.userId,
        workspaceId: perm.workspaceId,
        actorId: userId,
        type: "thread_mention",
        payload: {
          assetId: perm.assetId,
          threadId,
          messageId,
          snippet: body.body.slice(0, 200),
        },
        href: `/library?asset=${perm.assetId}&message=${messageId}`,
      });
    })
  );

  const [hydrated] = await hydrateMessages(
    [editResult.updated as MessageRow],
    userId
  );

  finishLog("ok", {
    details: {
      workspaceId: perm.workspaceId,
      messageId,
      newMentions: newMentions.length,
    },
  });

  return NextResponse.json({
    message: hydrated,
    eventId: editResult.eventId,
  });
}

// ---------------------------------------------------------------------------
// DELETE — soft-delete
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  if (!env.THREADS_ENABLED) return flagOff();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: threadId, messageId } = await params;
  const finishLog = startThreadTimer({
    event: "message.delete",
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

  const existing = await db
    .select({
      id: messages.id,
      threadId: messages.threadId,
      authorId: messages.authorId,
      deletedAt: messages.deletedAt,
    })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  const msg = existing[0];
  if (!msg || msg.threadId !== threadId) {
    finishLog("rejected", {
      details: { reason: "message_not_found", workspaceId: perm.workspaceId },
    });
    return NextResponse.json({ error: "message_not_found" }, { status: 404 });
  }
  if (msg.deletedAt) {
    finishLog("ok", {
      details: { workspaceId: perm.workspaceId, alreadyDeleted: true },
    });
    return NextResponse.json({ ok: true, alreadyDeleted: true });
  }
  if (msg.authorId !== userId && !canModerate(perm.role)) {
    finishLog("rejected", {
      details: { reason: "forbidden", workspaceId: perm.workspaceId },
    });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let result: { eventId: string };
  try {
    result = await withThreadTransaction(async (tx) => {
    const now = new Date();
    await tx
      .update(messages)
      .set({ body: null, deletedAt: now })
      .where(eq(messages.id, messageId));

    const eventId = randomUUID();
    await pgNotifyThreadEvent(
      {
        threadId,
        kind: "message.deleted",
        messageId,
        actorId: userId,
        eventId,
      },
      tx
    );
    return { eventId };
  });
  } catch (err) {
    finishLog("error", {
      details: { workspaceId: perm.workspaceId, stage: "transaction" },
      error: extractSqlState(err),
    });
    throw err;
  }

  finishLog("ok", { details: { workspaceId: perm.workspaceId, messageId } });
  return NextResponse.json({ ok: true, eventId: result.eventId });
}
