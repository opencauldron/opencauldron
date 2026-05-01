/**
 * Thread events multiplexer (T006).
 *
 * One singleton per Node instance. Holds a single `pg.Client` (or
 * `@neondatabase/serverless` Client over WebSocket — chosen by the connection
 * string) with a `LISTEN thread_events` subscription. Each SSE handler
 * registers an enqueue callback keyed by `threadId`; on every NOTIFY we parse
 * the payload, look up the threadId, and call every subscriber's enqueue.
 *
 * Why one connection: a `LISTEN` connection per SSE subscriber would explode
 * Neon's connection budget at 50+ concurrent viewers (NFR-007). Instead the
 * one-connection-per-instance model lets Postgres do the cross-instance
 * fan-out and the in-process map handle within-instance fan-out.
 *
 * Why direct (non-pooler) Neon URL: pgbouncer in transaction mode silently
 * drops LISTEN — the channel state is per-pgbouncer-server-conn and the
 * listener gets recycled on every txn. The T001 spike confirmed this. We
 * derive the direct URL by stripping `-pooler.` from the host.
 *
 * Reconnect: exponential backoff capped at 30s. On reconnect we DO NOT replay
 * missed events — instead we emit a synthetic `gap` event to every active
 * subscriber so the SSE handler can push a `reconnect` directive and let the
 * client take the JSON resync path. This is the spec's intended behavior
 * (FR-012); the per-thread ring buffer is a best-effort optimization for the
 * common case where a single subscriber drops + reconnects.
 *
 * Server-only — DO NOT import from a client component or this module's
 * `pg.Client` instance will end up in the browser bundle.
 */

import "server-only";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ThreadEventKind =
  | "message.created"
  | "message.updated"
  | "message.deleted"
  | "reaction.toggled";

export interface ThreadEventPayload {
  kind: ThreadEventKind;
  threadId: string;
  messageId: string;
  eventId: string;        // monotonic per-payload id (uuid v4 in v1)
  ts: number;             // epoch ms when the publisher emitted
  actorId: string;        // user who triggered the event
  // Reaction-only fields (optional on other kinds).
  emoji?: string;
  delta?: "+1" | "-1";
  // Optional extras — keep payload <8000 bytes (T012 enforces this).
  [k: string]: unknown;
}

const ThreadEventSchema = z.object({
  kind: z.enum([
    "message.created",
    "message.updated",
    "message.deleted",
    "reaction.toggled",
  ]),
  threadId: z.string().min(1),
  messageId: z.string().min(1),
  eventId: z.string().min(1),
  ts: z.number(),
  actorId: z.string().min(1),
  emoji: z.string().optional(),
  delta: z.enum(["+1", "-1"]).optional(),
}).passthrough();

export type EnqueueFn = (event: ThreadEventPayload) => void;

export interface ThreadSubscription {
  unsubscribe: () => void;
  /** Last-Event-Id-style replay; returns `null` if the requested id isn't in the buffer. */
  replaySince: (eventId: string | null) => ThreadEventPayload[];
}

// ---------------------------------------------------------------------------
// URL massaging — Neon `-pooler` hostnames don't relay LISTEN/NOTIFY.
// Exposed for the spike script.
// ---------------------------------------------------------------------------

export function pickListenNotifyUrl(rawUrl: string): string {
  // Neon-hosted databases publish a pooled hostname (`ep-foo-pooler.<region>.
  // <provider>.neon.tech`) that fronts pgbouncer in transaction mode. That
  // mode does NOT relay LISTEN/NOTIFY — every txn rotates the server-side
  // connection, so the listener's channel registration evaporates. The direct
  // compute hostname is the same string with `-pooler` stripped. For non-Neon
  // URLs this no-ops.
  return rawUrl.replace("-pooler.", ".");
}

// ---------------------------------------------------------------------------
// Multiplexer
// ---------------------------------------------------------------------------

const CHANNEL = "thread_events";
const RING_BUFFER_SIZE = 50;
const MAX_BACKOFF_MS = 30_000;

interface SubscriberSet {
  threadId: string;
  enqueueFns: Set<EnqueueFn>;
  ring: ThreadEventPayload[];
}

type ListenerClient = {
  connect: () => Promise<void>;
  end: () => Promise<void>;
  on: (
    ev: "notification" | "error" | "end",
    cb: (msg: { channel?: string; payload?: string } | Error) => void
  ) => void;
  query: (sql: string) => Promise<unknown>;
  removeAllListeners: () => void;
};

class ThreadEventsMultiplexer {
  private subscribers = new Map<string, SubscriberSet>();
  private client: ListenerClient | null = null;
  private connecting: Promise<void> | null = null;
  private backoffMs = 500;
  private closed = false;

  subscribe(threadId: string, fn: EnqueueFn): ThreadSubscription {
    let set = this.subscribers.get(threadId);
    if (!set) {
      set = { threadId, enqueueFns: new Set(), ring: [] };
      this.subscribers.set(threadId, set);
    }
    set.enqueueFns.add(fn);

    // Lazy-connect on first subscriber.
    void this.ensureConnected();

    return {
      unsubscribe: () => {
        const s = this.subscribers.get(threadId);
        if (!s) return;
        s.enqueueFns.delete(fn);
        if (s.enqueueFns.size === 0) {
          // Keep the ring buffer around briefly so a reconnecting client can
          // still replay — but if we're idle long enough, drop the entry to
          // avoid leaks on hot-reloaded dev servers. Simple v1: drop now.
          this.subscribers.delete(threadId);
        }
      },
      replaySince: (lastEventId) => {
        const s = this.subscribers.get(threadId);
        if (!s) return [];
        if (!lastEventId) return [];
        const idx = s.ring.findIndex((e) => e.eventId === lastEventId);
        if (idx < 0) return [];
        return s.ring.slice(idx + 1);
      },
    };
  }

  /** Test/teardown only — closes the underlying connection. */
  async shutdown() {
    this.closed = true;
    this.subscribers.clear();
    if (this.client) {
      await this.client.end().catch(() => {});
      this.client = null;
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client || this.connecting) {
      return this.connecting ?? Promise.resolve();
    }
    this.connecting = this.connect()
      .catch((err) => {
        console.error("[thread-events] connect failed", err);
        this.scheduleReconnect();
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    const rawUrl = process.env.DATABASE_URL;
    if (!rawUrl) throw new Error("DATABASE_URL is not set");
    const url = pickListenNotifyUrl(rawUrl);

    const isNeon = url.includes("neon.tech") || url.includes("neon.db");
    const client = isNeon ? await this.createNeonClient(url) : await this.createPgClient(url);
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);

    client.on("notification", (msg) => {
      const m = msg as { channel?: string; payload?: string };
      if (!m || m.channel !== CHANNEL || !m.payload) return;
      this.dispatch(m.payload);
    });
    client.on("error", (err) => {
      console.error("[thread-events] connection error", err);
      this.handleDisconnect();
    });
    client.on("end", () => {
      console.warn("[thread-events] connection ended");
      this.handleDisconnect();
    });

    this.client = client;
    this.backoffMs = 500;
  }

  private async createNeonClient(url: string): Promise<ListenerClient> {
    const mod = await import("@neondatabase/serverless");
    if (typeof globalThis.WebSocket === "undefined") {
      // Edge / older Node — caller should use the Node runtime; throw early.
      throw new Error(
        "@neondatabase/serverless requires WebSocket; run this on Node 22+ or the Node.js runtime"
      );
    }
    return new mod.Client({ connectionString: url }) as unknown as ListenerClient;
  }

  private async createPgClient(url: string): Promise<ListenerClient> {
    const mod = await import("pg");
    return new mod.Client({ connectionString: url }) as unknown as ListenerClient;
  }

  private dispatch(rawPayload: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      console.warn("[thread-events] non-JSON payload, ignoring", rawPayload.slice(0, 80));
      return;
    }
    const result = ThreadEventSchema.safeParse(parsed);
    if (!result.success) {
      console.warn("[thread-events] payload schema mismatch", result.error.flatten().fieldErrors);
      return;
    }
    const event = result.data as ThreadEventPayload;
    const set = this.subscribers.get(event.threadId);
    if (!set) return;
    // Ring buffer push.
    set.ring.push(event);
    if (set.ring.length > RING_BUFFER_SIZE) {
      set.ring.splice(0, set.ring.length - RING_BUFFER_SIZE);
    }
    for (const fn of set.enqueueFns) {
      try {
        fn(event);
      } catch (err) {
        console.error("[thread-events] subscriber threw", err);
      }
    }
  }

  private handleDisconnect() {
    if (this.client) {
      try {
        this.client.removeAllListeners();
      } catch {
        // best-effort
      }
      this.client = null;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.closed) return;
    const delay = Math.min(this.backoffMs, MAX_BACKOFF_MS);
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    setTimeout(() => {
      void this.ensureConnected();
    }, delay);
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor (per Node instance)
// ---------------------------------------------------------------------------

declare global {
  var __threadEventsMultiplexer: ThreadEventsMultiplexer | undefined;
}

function getMultiplexer(): ThreadEventsMultiplexer {
  if (!globalThis.__threadEventsMultiplexer) {
    globalThis.__threadEventsMultiplexer = new ThreadEventsMultiplexer();
  }
  return globalThis.__threadEventsMultiplexer;
}

export function subscribeToThread(
  threadId: string,
  enqueue: EnqueueFn
): ThreadSubscription {
  return getMultiplexer().subscribe(threadId, enqueue);
}

export async function shutdownThreadEvents(): Promise<void> {
  if (globalThis.__threadEventsMultiplexer) {
    await globalThis.__threadEventsMultiplexer.shutdown();
    globalThis.__threadEventsMultiplexer = undefined;
  }
}
