/**
 * pg_notify wrapper for thread events (T012).
 *
 * Why this exists:
 *   * Centralises the channel name (`thread_events`) and JSON payload shape.
 *   * Validates payload size <8000 bytes — the Postgres pg_notify limit.
 *     Throws if exceeded so callers can't silently drop events.
 *   * Postgres pg_notify is transactional — notifications fire only on
 *     commit. Calling this inside a `db.transaction()` callback is safe and
 *     the spec's intended behavior; a rollback drops the notification too.
 *
 * Payload deliberately small per plan + risks doc — only `{kind, threadId,
 * messageId, eventId, ts, actorId, ...}`. The full message body is fetched
 * by the SSE handler via the JSON API on the first event after a gap.
 *
 * Note on identifier injection: we pass the JSON via a parameterised query
 * (`$1::text`) so even though the channel name is interpolated into the
 * SQL string, the payload itself is not. Channel name is a hard-coded
 * literal — never user input.
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";
import type { ThreadEventKind } from "@/lib/realtime/thread-events";

const CHANNEL = "thread_events";
export const PG_NOTIFY_PAYLOAD_LIMIT = 8000;

export interface ThreadNotifyInput {
  threadId: string;
  kind: ThreadEventKind;
  messageId: string;
  actorId: string;
  /** Auto-generated when omitted. Stable across retries from the same call site. */
  eventId?: string;
  /** Reaction-only fields. */
  emoji?: string;
  delta?: "+1" | "-1";
  /** Free-form extras — keep it tiny. */
  extra?: Record<string, unknown>;
}

export interface PgNotifyExecutor {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

export class ThreadNotifyPayloadTooLargeError extends Error {
  constructor(public size: number) {
    super(`pg_notify payload exceeds ${PG_NOTIFY_PAYLOAD_LIMIT} bytes (got ${size})`);
    this.name = "ThreadNotifyPayloadTooLargeError";
  }
}

/**
 * Fire a `thread_events` NOTIFY. Pass `tx` (a transaction context from
 * `db.transaction(async (tx) => ...)`) to make the notify part of the
 * surrounding transaction; omit it to fire on the global db handle.
 */
export async function pgNotifyThreadEvent(
  input: ThreadNotifyInput,
  tx?: PgNotifyExecutor
): Promise<{ eventId: string }> {
  const eventId = input.eventId ?? randomUUID();
  const payload: Record<string, unknown> = {
    kind: input.kind,
    threadId: input.threadId,
    messageId: input.messageId,
    eventId,
    ts: Date.now(),
    actorId: input.actorId,
    ...(input.emoji !== undefined ? { emoji: input.emoji } : {}),
    ...(input.delta !== undefined ? { delta: input.delta } : {}),
    ...(input.extra ?? {}),
  };

  const json = JSON.stringify(payload);
  const size = Buffer.byteLength(json, "utf8");
  if (size > PG_NOTIFY_PAYLOAD_LIMIT) {
    throw new ThreadNotifyPayloadTooLargeError(size);
  }

  // Use parameterised pg_notify(text, text). Channel name is a constant.
  const exec = tx ?? db;
  await exec.execute(sql`SELECT pg_notify(${CHANNEL}, ${json})`);

  return { eventId };
}
