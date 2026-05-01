/**
 * Per-user thread upload storage quota (T054 / Phase 6).
 *
 * NFR target: a user can't quietly fill the bucket by automating a paste
 * loop. Soft-cap is the trailing 24h of `kind = 'upload'` bytes across
 * every thread the user has posted to (not just the current thread —
 * the cap is per-user, not per-thread).
 *
 * `asset_ref` and `external_link` attachments don't own R2 bytes so they
 * don't count toward the cap.
 *
 * Implementation: a single SUM aggregation per upload-attempt. The
 * `messages_thread_created_idx` index already filters by `created_at`, so
 * the read is cheap even with millions of messages — it walks the trailing
 * window only. Acceptable for v1.
 *
 * v2 (post-launch): if the SUM scan turns into a hot-path issue, replace
 * with a `user_thread_storage_counters` rolling-window table updated on
 * each upload + lazily reset by a sweeper. Migration `0019_thread_storage_
 * counter.sql` drafts the table shape — DO NOT APPLY until proven needed.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messageAttachments, messages } from "@/lib/db/schema";

export interface QuotaCheckResult {
  /** Aggregated bytes the user uploaded in the trailing 24h (pre-this-attempt). */
  usedBytes: number;
  /** Maximum allowed bytes per `THREAD_USER_DAILY_STORAGE_BYTES`. */
  limitBytes: number;
  /** Whether this upload would push the user over the limit. */
  overLimit: boolean;
  /** Seconds until the oldest contributing attachment falls out of the window. */
  retryAfterSeconds: number | null;
}

/**
 * Aggregate the bytes a user has uploaded in the trailing 24h. Cheap-ish:
 * the index on `messages.thread_id, created_at, id` makes the inner
 * filter sequential; the join is on the `message_attachments_message_idx`.
 */
export async function checkUserDailyStorageQuota(args: {
  userId: string;
  candidateBytes: number;
  limitBytes: number;
  windowMs?: number;
}): Promise<QuotaCheckResult> {
  const windowMs = args.windowMs ?? 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - windowMs);

  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${messageAttachments.fileSize}), 0)::bigint`,
      oldest: sql<Date | null>`MIN(${messages.createdAt})`,
    })
    .from(messageAttachments)
    .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
    .where(
      and(
        eq(messages.authorId, args.userId),
        eq(messageAttachments.kind, "upload"),
        gte(messages.createdAt, cutoff)
      )
    );

  // Drizzle returns the bigint as string when going through neon-http; coerce.
  const usedBytes = Number(rows[0]?.total ?? 0);
  const oldest = rows[0]?.oldest ?? null;

  const wouldUse = usedBytes + args.candidateBytes;
  const overLimit = wouldUse > args.limitBytes;

  let retryAfterSeconds: number | null = null;
  if (overLimit && oldest) {
    const oldestDate = oldest instanceof Date ? oldest : new Date(oldest);
    // The window is anchored on the oldest contributing message — once it
    // ages out, that message's bytes leave the SUM. This is a *coarse* hint
    // (we don't know how many bytes the oldest message contributes), but
    // it's the right order of magnitude for the client's `Retry-After`.
    const ageMs = Date.now() - oldestDate.getTime();
    retryAfterSeconds = Math.max(60, Math.ceil((windowMs - ageMs) / 1000));
  }

  return {
    usedBytes,
    limitBytes: args.limitBytes,
    overLimit,
    retryAfterSeconds,
  };
}
