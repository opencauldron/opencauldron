/**
 * measure-thread-latency.ts — Phase 6 / T057.
 *
 * NFR-001 budget: SSE delivery latency p50 < 500ms / p95 < 1500ms.
 *
 * Strategy:
 *   1. Open N concurrent EventSource connections to /api/threads/<id>/stream
 *      using the dev-login bypass cookie. Each subscriber records
 *      `eventId -> firstSeenAt` (epoch ms) on the first time it sees an
 *      event id.
 *   2. From a separate session, POST M messages to /api/threads/<id>/messages,
 *      capturing the server's `eventId` in the response body. Track
 *      `eventId -> postedAt` from the moment the request completes.
 *   3. After a settle window, compute latency = firstSeenAt - postedAt for
 *      every (eventId, subscriber) pair. Aggregate p50 / p95 / max.
 *
 * Caveats / honest framing:
 *   - The script runs against a single Node instance (the local dev server).
 *     Production has more multiplexer instances + pg latency from a
 *     remote Postgres. The numbers here are a *floor* — production will
 *     be slower. The NFR-001 budget is generous enough to allow that.
 *   - `postedAt` is timestamped *after* the POST returns, which already
 *     includes the round-trip from `pg_notify` back to all subscribers
 *     on the same instance (the multiplexer is in-process). So a near-
 *     zero number for same-instance subscribers is expected.
 *
 * Usage:
 *   DEV_LOGIN_USER_ID=<uuid> pnpm tsx scripts/measure-thread-latency.ts \
 *     --thread <threadId> --subscribers 10 --messages 30
 *
 * Pre-req: dev server running on localhost:9999 with DEV_LOGIN_ENABLED=true.
 */

import dotenv from "dotenv";
import { EventSource } from "eventsource";

dotenv.config({ path: ".env.local" });

// The userland `eventsource` v3 package supports a `fetch` hook so we can
// inject the dev-login auth cookie. Node's built-in EventSource is gated
// behind --experimental-eventsource even in Node 24, so we use the lib.
type EventSourceInstance = InstanceType<typeof EventSource>;
const EventSourceImpl = EventSource;

interface Args {
  baseUrl: string;
  threadId: string;
  subscribers: number;
  messages: number;
  userId: string;
  /**
   * One or more poster identities (comma-separated). Messages round-robin
   * across them so the per-(user, thread) rate-limit bucket doesn't trip
   * on larger samples (NFR-004 caps a single user at 20 msgs/min).
   */
  posterEmails: string[];
  settleMs: number;
  intervalMs: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string, fallback?: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const email = get("email", process.env.DEV_LOGIN_EMAIL);
  if (!email) {
    throw new Error(
      "missing email — pass --email <addr> or set DEV_LOGIN_EMAIL"
    );
  }
  const posterRaw = get("poster", email)!;
  const posterEmails = posterRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    baseUrl: get("base", "http://localhost:9999")!,
    threadId: get("thread", "")!,
    subscribers: Number(get("subscribers", "5")),
    messages: Number(get("messages", "20")),
    userId: email, // subscriber identity (the one that opens EventSources)
    posterEmails,
    settleMs: Number(get("settle", "1500")),
    intervalMs: Number(get("interval", "50")),
  };
}

interface DevLoginCookies {
  raw: string;
}

async function devLogin(baseUrl: string, email: string): Promise<DevLoginCookies> {
  const res = await fetch(
    `${baseUrl}/api/dev-login?email=${encodeURIComponent(email)}&next=/library`,
    { redirect: "manual" }
  );
  if (res.status !== 302 && res.status !== 307 && res.status !== 200) {
    throw new Error(`dev-login failed: ${res.status} ${await res.text()}`);
  }
  // undici exposes individual Set-Cookie headers via getSetCookie(). Older
  // implementations comma-fold them, which mangles cookie attributes that
  // legitimately contain commas (Expires=...).
  const headers = res.headers as unknown as { getSetCookie?: () => string[] };
  const cookies: string[] = headers.getSetCookie?.() ?? [];
  if (cookies.length === 0) {
    const raw = res.headers.get("set-cookie");
    if (!raw) throw new Error("dev-login returned no Set-Cookie");
    cookies.push(raw);
  }
  // Pick out only the auth cookie — the route also sets csrf + callback-url
  // helpers we don't need for protected route auth.
  const sessionCookie = cookies.find((c) =>
    c.startsWith("authjs.session-token=")
  );
  if (!sessionCookie) {
    throw new Error(
      "dev-login response had no authjs.session-token cookie: " +
        cookies.map((c) => c.split("=")[0]).join(",")
    );
  }
  const nameValue = sessionCookie.split(";")[0];
  return { raw: nameValue };
}

interface Subscriber {
  index: number;
  eventSource: EventSourceInstance;
  seen: Map<string, number>;
}

function openSubscriber(args: {
  baseUrl: string;
  threadId: string;
  cookies: DevLoginCookies;
  index: number;
}): Promise<Subscriber> {
  return new Promise((resolve, reject) => {
    const url = `${args.baseUrl}/api/threads/${args.threadId}/stream`;
    const seen = new Map<string, number>();
    const es = new EventSourceImpl(url, {
      // Send the auth cookie via the fetch hook (Node 22+ undici supports it).
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, {
          ...init,
          headers: {
            ...(init?.headers ?? {}),
            cookie: args.cookies.raw,
          },
        })) as typeof fetch,
    });
    const onEvent = (kind: string) => (ev: { lastEventId: string }) => {
      const t = Date.now();
      try {
        const id = ev.lastEventId;
        if (id && !seen.has(id)) {
          seen.set(id, t);
        }
      } catch {
        /* drop */
      }
      void kind;
    };
    es.addEventListener("message.created", onEvent("message.created"));
    es.addEventListener("message.updated", onEvent("message.updated"));
    es.addEventListener("message.deleted", onEvent("message.deleted"));
    es.addEventListener("reaction.toggled", onEvent("reaction.toggled"));
    es.onopen = () =>
      resolve({ index: args.index, eventSource: es, seen });
    es.onerror = (err) => {
      // eventsource' first 'error' fires before 'open' on a 401; surface that.
      if (es.readyState === 0) {
        reject(err);
      }
    };
  });
}

interface PostResult {
  eventId: string;
  postedAt: number;
  committedAt: number;
}

async function postMessage(args: {
  baseUrl: string;
  threadId: string;
  cookies: DevLoginCookies;
  body: string;
}): Promise<{ ok: PostResult } | { rateLimited: true } | { error: string }> {
  const t0 = Date.now();
  const res = await fetch(`${args.baseUrl}/api/threads/${args.threadId}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: args.cookies.raw,
    },
    body: JSON.stringify({ body: args.body }),
  });
  if (res.status === 429) {
    // Drain the body so the connection returns to the pool cleanly.
    await res.text();
    return { rateLimited: true };
  }
  if (!res.ok) {
    return { error: `${res.status} ${await res.text()}` };
  }
  // `committedAt` is the moment the response (carrying the server-assigned
  // eventId) is back on this side — a closer proxy for "when was the event
  // available to the multiplexer" than `postedAt`.
  const t1 = Date.now();
  const json = (await res.json()) as { eventId?: string };
  if (!json.eventId) return { error: "no_event_id" };
  return { ok: { eventId: json.eventId, postedAt: t0, committedAt: t1 } };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i];
}

async function main() {
  const args = parseArgs();
  console.log(`[load] subscribers=${args.subscribers} messages=${args.messages} thread=${args.threadId}`);

  const cookies = await devLogin(args.baseUrl, args.userId);
  // Authenticate every poster identity up front. Same-as-subscriber email
  // shares the cookie pool to save a round-trip.
  const posterCookies: DevLoginCookies[] = await Promise.all(
    args.posterEmails.map((p) =>
      p === args.userId ? Promise.resolve(cookies) : devLogin(args.baseUrl, p)
    )
  );
  console.log(
    `[load] ${posterCookies.length} poster identities authenticated (${args.posterEmails.join(", ")})`
  );

  // Open all subscribers in parallel.
  const subs = await Promise.all(
    Array.from({ length: args.subscribers }, (_, i) =>
      openSubscriber({
        baseUrl: args.baseUrl,
        threadId: args.threadId,
        cookies,
        index: i,
      })
    )
  );
  console.log(`[load] ${subs.length} subscribers connected`);

  // Brief settle so all subscribers are committed in the multiplexer.
  await new Promise((r) => setTimeout(r, 250));

  const posted: PostResult[] = [];
  let rateLimited = 0;
  let errors = 0;
  for (let i = 0; i < args.messages; i++) {
    // Round-robin across poster identities so the per-(user, thread)
    // bucket doesn't trip on larger samples.
    const cookieIdx = i % posterCookies.length;
    const r = await postMessage({
      baseUrl: args.baseUrl,
      threadId: args.threadId,
      cookies: posterCookies[cookieIdx],
      body: `[load] ${i} @ ${Date.now()}`,
    });
    if ("ok" in r) {
      posted.push(r.ok);
    } else if ("rateLimited" in r) {
      rateLimited += 1;
    } else {
      errors += 1;
      console.error(`POST failed: ${r.error}`);
    }
    await new Promise((r) => setTimeout(r, args.intervalMs));
  }
  console.log(
    `[load] posted ${posted.length} / ${args.messages} (rate-limited=${rateLimited}, errors=${errors}), settling…`
  );

  // Settle: wait for the last few SSE pushes to drain.
  await new Promise((r) => setTimeout(r, args.settleMs));

  // Tear down.
  for (const s of subs) s.eventSource.close();

  // Two views of latency:
  //   * `wallLatencies` — from POST start (client-side) to event arrival;
  //     includes the full request round-trip.
  //   * `commitLatencies` — from POST response to event arrival; the
  //     `committedAt` is when the server hands back the eventId, so this
  //     view is dominated by the multiplexer push (which is what NFR-001
  //     actually targets — "realtime delivery latency").
  const wallLatencies: number[] = [];
  const commitLatencies: number[] = [];
  let missing = 0;
  for (const p of posted) {
    for (const s of subs) {
      const seenAt = s.seen.get(p.eventId);
      if (seenAt === undefined) {
        missing += 1;
        continue;
      }
      wallLatencies.push(seenAt - p.postedAt);
      commitLatencies.push(seenAt - p.committedAt);
    }
  }
  wallLatencies.sort((a, b) => a - b);
  commitLatencies.sort((a, b) => a - b);

  const wallP50 = quantile(wallLatencies, 0.5);
  const wallP95 = quantile(wallLatencies, 0.95);
  const wallMax =
    wallLatencies.length > 0 ? wallLatencies[wallLatencies.length - 1] : NaN;
  const commitP50 = quantile(commitLatencies, 0.5);
  const commitP95 = quantile(commitLatencies, 0.95);
  const commitMax =
    commitLatencies.length > 0 ? commitLatencies[commitLatencies.length - 1] : NaN;

  const report = {
    subscribers: args.subscribers,
    messages: args.messages,
    posters: args.posterEmails.length,
    intervalMs: args.intervalMs,
    rateLimited,
    errors,
    expectedDeliveries: posted.length * subs.length,
    actualDeliveries: wallLatencies.length,
    missing,
    wall: {
      p50_ms: wallP50,
      p95_ms: wallP95,
      max_ms: wallMax,
      note: "POST start → SSE arrive — includes request round-trip",
    },
    commit: {
      p50_ms: commitP50,
      p95_ms: commitP95,
      max_ms: commitMax,
      note: "POST response → SSE arrive — multiplexer push only",
    },
    nfr001_budget: { p50: 500, p95: 1500 },
    pass:
      Number.isFinite(commitP50) &&
      Number.isFinite(commitP95) &&
      commitP50 <= 500 &&
      commitP95 <= 1500 &&
      missing === 0,
  };

  console.log(JSON.stringify(report, null, 2));

  process.exit(report.pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
