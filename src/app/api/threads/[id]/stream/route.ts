/**
 * GET /api/threads/[id]/stream — Server-Sent Events stream (T022).
 *
 * Auth + workspace membership + `THREADS_ENABLED` flag. Subscribes the
 * connection to the thread-events multiplexer and forwards every event to
 * the client as an SSE frame.
 *
 * Honors `Last-Event-Id`: if the client sends one, we replay any events
 * still in the per-thread ring buffer that are newer than the requested id.
 * If the buffer doesn't have it (gap too large), we fall through to the
 * normal stream and the client takes the JSON resync path.
 *
 * Heartbeat + proactive reconnect handled by `createSseStream` (T007).
 *
 * Pinned to the Node runtime — the multiplexer's `pg.Client` and the
 * `WebSocket`-backed Neon driver both want Node.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  PermissionError,
  assertWorkspaceMemberForThread,
} from "@/lib/threads/permissions";
import { subscribeToThread } from "@/lib/realtime/thread-events";
import { createSseStream } from "@/lib/realtime/sse";
import {
  extractSqlState,
  logThreadEvent,
} from "@/lib/threads/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function flagOff(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

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
  const connectedAt = performance.now();

  let perm;
  try {
    perm = await assertWorkspaceMemberForThread(userId, threadId);
  } catch (err) {
    if (err instanceof PermissionError) {
      logThreadEvent({
        event: "sse.connect",
        threadId,
        userId,
        workspaceId: null,
        latencyMs: Math.round(performance.now() - connectedAt),
        outcome: "rejected",
        details: { reason: "permission", status: err.status },
      });
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logThreadEvent({
      event: "sse.connect",
      threadId,
      userId,
      workspaceId: null,
      latencyMs: Math.round(performance.now() - connectedAt),
      outcome: "error",
      error: extractSqlState(err),
    });
    throw err;
  }

  const lastEventId = req.headers.get("last-event-id");

  // Subscribe BEFORE returning the stream so we don't miss events that fire
  // between the subscribe + the first push.
  let subscription: ReturnType<typeof subscribeToThread> | null = null;
  const handle = createSseStream({
    onClose: () => {
      subscription?.unsubscribe();
      logThreadEvent({
        event: "sse.disconnect",
        threadId,
        userId,
        workspaceId: perm.workspaceId,
        latencyMs: Math.round(performance.now() - connectedAt),
        outcome: "ok",
      });
    },
  });

  logThreadEvent({
    event: "sse.connect",
    threadId,
    userId,
    workspaceId: perm.workspaceId,
    latencyMs: Math.round(performance.now() - connectedAt),
    outcome: "ok",
    details: { hasLastEventId: !!lastEventId },
  });

  subscription = subscribeToThread(threadId, (event) => {
    handle.push({
      event: event.kind,
      id: event.eventId,
      data: event,
    });
  });

  // Replay any buffered events newer than `Last-Event-Id`. If the buffer
  // doesn't contain the id, this returns [] and the client falls through to
  // its on-open JSON resync path.
  if (lastEventId) {
    const replay = subscription.replaySince(lastEventId);
    for (const event of replay) {
      handle.push({
        event: event.kind,
        id: event.eventId,
        data: event,
      });
    }
  }

  // Hook the request abort signal so the stream tears down cleanly when the
  // client disconnects (browser tab close, navigation away).
  req.signal.addEventListener("abort", () => {
    handle.close();
  });

  return handle.response;
}
