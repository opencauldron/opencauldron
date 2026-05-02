/**
 * Per-IP read rate limit for the public campaign gallery surface (T018).
 *
 * Token bucket — two ceilings tracked per key:
 *   * `maxPerMinute`  (sliding 60s window, default 60/min — page route)
 *   * `burstPer5s`    (sliding 5s window, default 10/5s — page route)
 *
 * Both windows must have headroom for the request to pass. Returns either
 * `{ ok: true, retryAfterMs: 0 }` or `{ ok: false, retryAfterMs }` so the
 * caller can populate a 429 response with `Retry-After`.
 *
 * The download endpoint passes a tighter `{ maxPerMinute: 30, burstPer5s: 5 }`
 * via `options` — see `plan.md` D5. Mirrors the shape of
 * `src/lib/threads/rate-limit.ts` so the upgrade path to a Redis-backed
 * implementation is mechanical.
 *
 * IP source: callers resolve the client IP from the request headers via
 *   `request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'`
 * (Vercel injects `x-forwarded-for`; the `'unknown'` fallback handles dev /
 * self-hosted setups where the header is absent — all such requests share a
 * single bucket, which is the conservative choice).
 *
 * Storage: module-scoped `Map`. By design no shared state across Node
 * instances — a single IP fanned across instances by a load balancer can
 * exceed the cap by ~Nx. That's an accepted v1 trade-off; Vercel typically
 * sticks the same client to the same instance for a session, and the cap is
 * already low enough that the abuse blast radius is small.
 *
 * Eviction: keys are GC'd lazily on every check (skip-if-window-empty), and
 * a periodic sweep every 60s drops keys with no recent activity. The sweep
 * is harmless on serverless (the process either stays warm and runs it, or
 * cold-starts with an empty Map anyway).
 */

interface Bucket {
  /** Timestamps (ms) for the last minute of hits. */
  minute: number[];
  /** Timestamps (ms) for the last 5s of hits. */
  burst: number[];
}

const MINUTE_MS = 60_000;
const BURST_MS = 5_000;

const DEFAULT_MAX_PER_MINUTE = 60;
const DEFAULT_BURST_PER_5S = 10;

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

export interface IpRateLimitResult {
  ok: boolean;
  retryAfterMs: number;
}

/**
 * Check the rate limit AND record the hit if it would pass. The combined
 * shape avoids the TOCTOU race where two concurrent requests both pass the
 * "check" then both record a hit that exceeds the cap.
 *
 * `retryAfterMs` is `0` on success and a positive integer (ms until the
 * oldest in-window hit ages out) on failure. Callers convert to seconds via
 * `Math.ceil(retryAfterMs / 1000)` when populating the `Retry-After` header.
 */
export function checkAndConsumeIpRateLimit(
  ip: string,
  options?: { maxPerMinute?: number; burstPer5s?: number }
): IpRateLimitResult {
  ensureSweep();

  const maxPerMinute = options?.maxPerMinute ?? DEFAULT_MAX_PER_MINUTE;
  const burstPer5s = options?.burstPer5s ?? DEFAULT_BURST_PER_5S;

  const k = ip;
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
export function __resetForTests() {
  buckets.clear();
}
