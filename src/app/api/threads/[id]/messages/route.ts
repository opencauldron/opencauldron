/**
 * /api/threads/[id]/messages — message list + create.
 *
 * GET   ?cursor=&since=&limit=  Older-page cursor or resync-since fetch.
 * POST  body: { body, parentMessageId?, attachments?, clientTempId? }
 *
 * Both endpoints gate on `THREADS_ENABLED` and workspace membership for the
 * thread's asset.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withThreadTransaction } from "@/lib/db/tx";
import { env } from "@/lib/env";
import {
  assetThreads,
  messageAttachments,
  messageMentions,
  messages,
} from "@/lib/db/schema";
import {
  PermissionError,
  assertWorkspaceMemberForThread,
} from "@/lib/threads/permissions";
import { hydrateMessages, type MessageRow } from "@/lib/threads/hydrate";
import { checkAndConsumeThreadRateLimit } from "@/lib/threads/rate-limit";
import { parseBody, type BodyMember } from "@/lib/threads/body-parse";
import {
  resolveWorkspaceMembersForMention,
  isMentionableInWorkspace,
} from "@/lib/threads/resolve-mentions";
import { pgNotifyThreadEvent } from "@/lib/threads/notify";
import {
  extractSqlState,
  startThreadTimer,
} from "@/lib/threads/telemetry";
import { createNotification } from "@/lib/notifications";
import { randomUUID } from "node:crypto";

// `withThreadTransaction` opens a WebSocket-backed Neon Pool client; the Edge
// runtime cannot host that, so pin to Node.
export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_BODY_LEN = 4000;
const MAX_ATTACHMENTS = 10;

function flagOff(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

function decodeCursor(raw: string | null): { createdAt: Date; id: string } | null {
  if (!raw) return null;
  const sep = raw.lastIndexOf("__");
  if (sep < 0) return null;
  const ts = raw.slice(0, sep);
  const id = raw.slice(sep + 2);
  const date = new Date(ts);
  if (Number.isNaN(date.getTime()) || !id) return null;
  return { createdAt: date, id };
}

function clampLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!env.THREADS_ENABLED) return flagOff();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: threadId } = await params;

  try {
    await assertWorkspaceMemberForThread(userId, threadId);
  } catch (err) {
    if (err instanceof PermissionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const url = new URL(req.url);
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const since = url.searchParams.get("since");
  const limit = clampLimit(url.searchParams.get("limit"));

  let rows;
  if (since) {
    // Resync — return everything strictly newer than `since`, oldest-first.
    const sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      return NextResponse.json({ error: "invalid_since" }, { status: 400 });
    }
    rows = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.threadId, threadId),
          gt(messages.createdAt, sinceDate)
        )
      )
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(limit);
  } else if (cursor) {
    // Older-page — strictly older than the cursor's (createdAt, id).
    rows = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.threadId, threadId),
          or(
            lt(messages.createdAt, cursor.createdAt),
            and(
              eq(messages.createdAt, cursor.createdAt),
              lt(messages.id, cursor.id)
            )
          )
        )
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit);
    rows = rows.reverse();
  } else {
    // Latest page — same as the by-asset endpoint shape.
    const latest = await db
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit);
    rows = latest.reverse();
  }

  const hydrated = await hydrateMessages(rows as MessageRow[], userId);
  const oldest = hydrated[0];
  const nextCursor =
    !since && hydrated.length === limit && oldest
      ? `${oldest.createdAt.toISOString()}__${oldest.id}`
      : null;

  return NextResponse.json({ messages: hydrated, nextCursor });
}

// ---------------------------------------------------------------------------
// POST — create message (T016)
// ---------------------------------------------------------------------------

const attachmentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("upload"),
    r2Key: z.string().min(1),
    r2Url: z.string().min(1),
    mimeType: z.string().min(1),
    fileSize: z.number().int().nonnegative().nullable().optional(),
    width: z.number().int().nonnegative().nullable().optional(),
    height: z.number().int().nonnegative().nullable().optional(),
    displayName: z.string().max(512).nullable().optional(),
  }),
  z.object({
    kind: z.literal("asset_ref"),
    assetId: z.string().uuid(),
    displayName: z.string().max(512).nullable().optional(),
  }),
  z.object({
    kind: z.literal("external_link"),
    url: z.string().url(),
    displayName: z.string().max(512).nullable().optional(),
  }),
]);

const postSchema = z.object({
  body: z.string().min(1).max(MAX_BODY_LEN),
  parentMessageId: z.string().uuid().nullable().optional(),
  attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional(),
  clientTempId: z.string().max(64).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!env.THREADS_ENABLED) return flagOff();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: threadId } = await params;
  const finishLog = startThreadTimer({
    event: "message.create",
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

  // Rate limit BEFORE parsing body so a bad actor's payload work is cheap.
  const rl = checkAndConsumeThreadRateLimit(userId, threadId);
  if (!rl.ok) {
    finishLog("rate_limited", {
      details: { workspaceId: perm.workspaceId, retryAfterMs: rl.retryAfterMs },
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

  // Reject `parentMessageId` that doesn't exist or belongs to another thread.
  let parentAuthorId: string | null = null;
  if (body.parentMessageId) {
    const parentRows = await db
      .select({
        id: messages.id,
        threadId: messages.threadId,
        authorId: messages.authorId,
        deletedAt: messages.deletedAt,
      })
      .from(messages)
      .where(eq(messages.id, body.parentMessageId))
      .limit(1);
    const parent = parentRows[0];
    if (!parent || parent.threadId !== threadId) {
      finishLog("rejected", {
        details: {
          reason: "invalid_parent_message",
          workspaceId: perm.workspaceId,
        },
      });
      return NextResponse.json(
        { error: "invalid_parent_message" },
        { status: 400 }
      );
    }
    // Spec FR-008: replies-to-replies attach to the same parent. Caller
    // should already do this client-side; we DO NOT auto-rewrite here so
    // bad clients get a clear error instead of silent surprises.
    parentAuthorId = parent.authorId;
  }

  // Parse mentions against the workspace's member list.
  const members: BodyMember[] = (
    await resolveWorkspaceMembersForMention(perm.workspaceId)
  ).map((m) => ({ id: m.id, displayName: m.displayName, handle: m.handle }));
  const parsed = parseBody(body.body, members);

  let result: {
    inserted: typeof messages.$inferSelect;
    eventId: string;
  };
  try {
    result = await withThreadTransaction(async (tx) => {
    const [inserted] = await tx
      .insert(messages)
      .values({
        threadId,
        workspaceId: perm.workspaceId,
        authorId: userId,
        parentMessageId: body.parentMessageId ?? null,
        body: body.body,
      })
      .returning();

    if (body.attachments && body.attachments.length > 0) {
      await tx.insert(messageAttachments).values(
        body.attachments.map((a, i) => {
          const base = {
            messageId: inserted.id,
            kind: a.kind,
            position: i,
            displayName: a.displayName ?? null,
          };
          if (a.kind === "upload") {
            return {
              ...base,
              r2Key: a.r2Key,
              r2Url: a.r2Url,
              mimeType: a.mimeType,
              fileSize: a.fileSize ?? null,
              width: a.width ?? null,
              height: a.height ?? null,
            };
          }
          if (a.kind === "asset_ref") {
            return { ...base, assetId: a.assetId };
          }
          return { ...base, url: a.url };
        })
      );
    }

    if (parsed.mentions.length > 0) {
      await tx
        .insert(messageMentions)
        .values(
          parsed.mentions.map((m) => ({
            messageId: inserted.id,
            mentionedUserId: m.userId,
          }))
        )
        .onConflictDoNothing();
    }

    await tx
      .update(assetThreads)
      .set({
        messageCount: sql`${assetThreads.messageCount} + 1`,
        lastMessageAt: inserted.createdAt,
      })
      .where(eq(assetThreads.id, threadId));

    // pg_notify is transactional — emit inside the txn so a rollback drops
    // the notification too. Decision documented in progress.md.
    const eventId = randomUUID();
    await pgNotifyThreadEvent(
      {
        threadId,
        kind: "message.created",
        messageId: inserted.id,
        actorId: userId,
        eventId,
      },
      tx
    );

    return { inserted, eventId };
  });
  } catch (err) {
    finishLog("error", {
      details: { workspaceId: perm.workspaceId, stage: "transaction" },
      error: extractSqlState(err),
    });
    throw err;
  }

  // Notifications fan out post-commit so a write failure doesn't leave
  // dangling notification rows. Done outside the transaction on purpose.
  await Promise.all([
    ...parsed.mentions
      .filter((m) => m.userId !== userId)
      .map(async (m) => {
        // Defense-in-depth — confirm the mentioned user is still a workspace
        // member at write time.
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
            messageId: result.inserted.id,
            snippet: body.body.slice(0, 200),
          },
          href: `/library?asset=${perm.assetId}&message=${result.inserted.id}`,
        });
      }),
    parentAuthorId && parentAuthorId !== userId
      ? createNotification({
          userId: parentAuthorId,
          workspaceId: perm.workspaceId,
          actorId: userId,
          type: "thread_reply",
          payload: {
            assetId: perm.assetId,
            threadId,
            messageId: result.inserted.id,
            parentMessageId: body.parentMessageId,
            snippet: body.body.slice(0, 200),
          },
          href: `/library?asset=${perm.assetId}&message=${result.inserted.id}`,
        })
      : Promise.resolve(),
  ]);

  // Hydrate the freshly-inserted message for the response.
  const [hydrated] = await hydrateMessages([result.inserted as MessageRow], userId);

  finishLog("ok", {
    details: {
      workspaceId: perm.workspaceId,
      messageId: result.inserted.id,
      hasParent: !!body.parentMessageId,
      attachments: body.attachments?.length ?? 0,
      mentions: parsed.mentions.length,
    },
  });

  return NextResponse.json(
    {
      message: hydrated,
      eventId: result.eventId,
      clientTempId: body.clientTempId ?? null,
    },
    { status: 201 }
  );
}
