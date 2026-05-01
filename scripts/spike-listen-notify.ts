/**
 * T001 spike — verify Postgres LISTEN/NOTIFY works through the project's Neon
 * driver path so the asset-threads realtime architecture is feasible.
 *
 * The production database is Neon (HTTP via `@neondatabase/serverless`
 * `neon()` for queries). HTTP cannot hold a session, which is required for
 * LISTEN. Neon's WebSocket-backed `Pool`/`Client` from the same package keeps
 * a real session and supports notifications. This spike opens TWO sessions
 * (one listener, one publisher) over WebSocket and confirms NOTIFY is
 * delivered to the listener.
 *
 * For non-Neon DATABASE_URLs (local Docker), it falls back to standard `pg`
 * Pool/Client.
 *
 * Usage:
 *   pnpm tsx scripts/spike-listen-notify.ts
 *
 * Exits 0 on success (both messages received within the latency budget) and
 * 1 on any failure. Logs driver path, latency observed, and gotchas to
 * stdout in a single structured line so the test in CI / progress.md can
 * paste the result verbatim.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const CHANNEL = "thread_events_spike";
const PAYLOAD_OBJ = { hello: "world", ts: Date.now() };
const TIMEOUT_MS = 10_000;

type Driver = "neon-ws" | "pg";

function pickDriver(url: string): Driver {
  return url.includes("neon.tech") || url.includes("neon.db") ? "neon-ws" : "pg";
}

async function importNeonClient() {
  const mod: typeof import("@neondatabase/serverless") = await import(
    "@neondatabase/serverless"
  );
  // Node 22+ has a global WebSocket. For older Node we'd need `ws`; we don't
  // ship one as a direct dep so this spike requires Node 22+ (the project
  // targets Node via Vercel which is 22 by default in 2026).
  if (typeof globalThis.WebSocket === "undefined") {
    try {
      // `ws` is not a direct dep so we can't `import` it statically. Use
      // dynamic import via a string the type checker can't follow; cast to
      // unknown to keep this script free of `@types/ws`.
      const wsModName = "ws";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws = (await import(/* @vite-ignore */ wsModName)) as any;
      mod.neonConfig.webSocketConstructor = ws.WebSocket as unknown as typeof WebSocket;
    } catch {
      throw new Error(
        "Node lacks WebSocket and `ws` is not installed — install `ws` or use Node 22+"
      );
    }
  }
  return mod.Client;
}

async function importPgClient() {
  const mod: typeof import("pg") = await import("pg");
  return mod.Client;
}

async function main() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    console.error("DATABASE_URL is not set in .env.local");
    process.exit(1);
  }

  // Neon `-pooler.` hostnames go through pgbouncer in transaction mode, which
  // does NOT relay LISTEN/NOTIFY (the channel state is per-pgbouncer-server-
  // connection and gets recycled after every transaction). Bypass to the
  // direct compute endpoint by stripping `-pooler` from the host. This is the
  // documented production fix for realtime workloads on Neon.
  const directUrl = rawUrl.replace("-pooler.", ".");
  const url = directUrl;
  const switched = directUrl !== rawUrl;

  const driver = pickDriver(url);
  console.log(
    `[spike] driver=${driver} url-host=${new URL(url.replace("postgresql://", "https://")).host} pooler-bypassed=${switched}`
  );

  const ClientCtor: new (cfg: { connectionString: string }) => {
    connect: () => Promise<void>;
    end: () => Promise<void>;
    on: (ev: string, cb: (msg: { channel: string; payload?: string }) => void) => void;
    query: (sql: string) => Promise<unknown>;
  } = driver === "neon-ws" ? ((await importNeonClient()) as never) : ((await importPgClient()) as never);

  const listener = new ClientCtor({ connectionString: url });
  const publisher = new ClientCtor({ connectionString: url });

  await listener.connect();
  await publisher.connect();

  let receivedAt = 0;
  let receivedPayload: string | undefined;
  const sentAt = Date.now();

  const received = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`timeout waiting for NOTIFY after ${TIMEOUT_MS}ms`)),
      TIMEOUT_MS
    );
    listener.on("notification", (msg) => {
      if (msg.channel === CHANNEL) {
        receivedAt = Date.now();
        receivedPayload = msg.payload;
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  await listener.query(`LISTEN ${CHANNEL}`);
  // Tiny delay so the LISTEN registration has visibly committed (defensive;
  // libpq queues LISTEN async on some drivers).
  await new Promise((r) => setTimeout(r, 50));

  const json = JSON.stringify(PAYLOAD_OBJ);
  // Use parameterised pg_notify(text, text) so quoting in the JSON is bulletproof.
  await publisher.query(`SELECT pg_notify('${CHANNEL}', '${json.replace(/'/g, "''")}')`);

  try {
    await received;
  } catch (err) {
    console.error("[spike] FAIL", err instanceof Error ? err.message : err);
    await listener.end().catch(() => {});
    await publisher.end().catch(() => {});
    process.exit(1);
  }

  const latencyMs = receivedAt - sentAt;
  const ok = receivedPayload === json;
  console.log(
    `[spike] result driver=${driver} delivered=${ok} latencyMs=${latencyMs} payload=${receivedPayload}`
  );

  await listener.end().catch(() => {});
  await publisher.end().catch(() => {});

  if (!ok) {
    console.error("[spike] FAIL — payload mismatch");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[spike] unexpected", err);
  process.exit(1);
});
