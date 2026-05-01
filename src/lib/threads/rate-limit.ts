/**
 * Per-(userId, threadId) write rate limit (T009).
 *
 * Token bucket — two ceilings tracked per key:
 *   * `maxPerMinute`  (sliding 60s window, drives NFR-004's 20/min cap)
 *   * `burstPer5s`    (sliding 5s window, drives the 5/5s burst cap)
 *
 * Both windows must have headroom for the request to pass. Returns either
 * `{ ok: true }` or `{ ok: false, retryAfterMs }` so the caller can populate
 * a 429 response with `Retry-After`.
 *
 * Storage: module-scoped `Map`. By design no shared state across Node
 * instances — a single user fanned across instances by a load balancer can
 * exceed the cap by ~Nx. That's an accepted v1 trade-off; the cap is per
 * user-thread already so the abuse blast radius is small.
 *
 * Eviction: keys are GC'd lazily on every check (skip-if-window-empty), and
 * a periodic sweep every 60s drops keys with no recent activity. The sweep
 * is harmless on serverless (the process either stays warm and runs it, or
 * cold-starts with an empty Map anyway).
 */

import { env } from "@/lib/env";

interface Bucket {
  /** Timestamps (ms) for the last minute of writes. */
  minute: number[];
  /** Timestamps (ms) for the last 5s of writes. */
  burst: number[];
}

const MINUTE_MS = 60_000;
const BURST_MS = 5_000;

const buckets = new Map<string, Bucket>();

let sweepTimer: ReturnType<typeof setInterval> | null = null;

function ensureSweep() {
  if (sweepTimer) return;
  // Best-effort cleanup — drop keys whose minute window is empty.
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      bucket.minute = bucket.minute.filter((t) => now - t < MINUTE_MS);
      bucket.burst = bucket.burst.filter((t) => now - t < BURST_MS);
      if (bucket.minute.length === 0 && bucket.burst.length === 0) {
        buckets.delete(key);
      }
    }
  }, MINUTE_MS).unref?.();
}

function key(userId: string, threadId: string, bucket?: string): string {
  // `bucket` lets callers separate quotas by action kind. Phase 4 introduces
  // a dedicated `reaction` bucket so reactions don't share the message
  // budget — NFR-004 calls for a separate 30/min ceiling.
  return bucket ? `${userId}:${threadId}:${bucket}` : `${userId}:${threadId}`;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterMs: number;
}

/**
 * Check the rate limit AND record the write if it would pass. The combined
 * shape avoids the TOCTOU race where two concurrent requests both pass the
 * "check" then both record a write that exceeds the cap.
 */
export function checkAndConsumeThreadRateLimit(
  userId: string,
  threadId: string,
  options?: { maxPerMinute?: number; burstPer5s?: number; bucket?: string }
): RateLimitResult {
  ensureSweep();

  const maxPerMinute = options?.maxPerMinute ?? env.THREAD_RATE_LIMIT_MAX_PER_MIN;
  const burstPer5s = options?.burstPer5s ?? env.THREAD_RATE_LIMIT_BURST_PER_5S;

  const k = key(userId, threadId, options?.bucket);
  const now = Date.now();
  let bucket = buckets.get(k);
  if (!bucket) {
    bucket = { minute: [], burst: [] };
    buckets.set(k, bucket);
  }
  bucket.minute = bucket.minute.filter((t) => now - t < MINUTE_MS);
  bucket.burst = bucket.burst.filter((t) => now - t < BURST_MS);

  if (bucket.minute.length >= maxPerMinute) {
    const oldest = bucket.minute[0];
    return { ok: false, retryAfterMs: MINUTE_MS - (now - oldest) };
  }
  if (bucket.burst.length >= burstPer5s) {
    const oldest = bucket.burst[0];
    return { ok: false, retryAfterMs: BURST_MS - (now - oldest) };
  }

  bucket.minute.push(now);
  bucket.burst.push(now);
  return { ok: true, retryAfterMs: 0 };
}

/** Test-only — drop all buckets between cases. */
export function __resetRateLimitsForTests() {
  buckets.clear();
}
