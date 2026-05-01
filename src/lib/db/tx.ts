/**
 * Transactional db handle for writes that need atomicity across multiple
 * tables (asset-threads message create / reactions / soft-delete).
 *
 * Why this exists: the project's main `db` handle uses
 * `drizzle-orm/neon-http` which is HTTP-fetch-backed. HTTP can't hold a
 * session, so `db.transaction(...)` is unsupported. For writes where a
 * partial commit would be incoherent (insert message + insert mentions +
 * pg_notify all-or-nothing), we open a short-lived WebSocket-backed Pool
 * client via `@neondatabase/serverless` and use drizzle's neon-serverless
 * adapter, which DOES expose `transaction()`.
 *
 * Boundaries:
 *   * Use `withThreadTransaction(async (tx) => ...)` ONLY inside a route
 *     handler running on the Node.js runtime. The Pool needs WebSocket.
 *   * Reads still go through the global `db` (HTTP driver — fast cold start).
 *   * Each call opens + closes a connection from the Pool. The Pool is
 *     module-scoped so warm processes amortise the connection cost.
 *
 * Pooler bypass NOT applied: read/write traffic over the pooler is fine,
 * even for transactions. The bypass is ONLY required for LISTEN/NOTIFY,
 * which doesn't happen here.
 */

import "server-only";
import { Pool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

/** The drizzle handle bound to a WebSocket Pool — supports `.transaction(...)`. */
export type ThreadTxDb = ReturnType<typeof drizzleNeon<typeof schema>>;

/** The transaction-scoped handle passed into the callback. */
export type ThreadTxScope = Parameters<ThreadTxDb["transaction"]>[0] extends (
  arg: infer A
) => unknown
  ? A
  : never;

/**
 * Run `fn` inside a Postgres transaction. The transaction is rolled back if
 * `fn` throws. The `tx` argument has the full drizzle query API plus
 * `tx.execute(sql\`...\`)` for raw statements (used for pg_notify).
 */
export async function withThreadTransaction<T>(
  fn: (tx: ThreadTxScope) => Promise<T>
): Promise<T> {
  const dbWithPool = drizzleNeon({ client: getPool(), schema });
  return dbWithPool.transaction(async (tx) => {
    return fn(tx);
  });
}
