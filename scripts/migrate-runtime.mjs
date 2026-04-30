#!/usr/bin/env node
/**
 * migrate-runtime.mjs — applies pending Drizzle migrations on container boot.
 *
 * Lives at the repo root (NOT under src/) so it stays out of the Next bundle.
 * Shipped into the runner stage alongside the `drizzle/` SQL folder; invoked
 * by `docker-entrypoint.sh` before `node server.js` starts.
 *
 * Driver: `pg` (drizzle-orm/node-postgres). Self-hosted Docker installs always
 * use a TCP Postgres (bundled or external); the Neon HTTP path is for hosted
 * SaaS deployments and never reaches this script.
 *
 * Exits 0 on success, 1 on failure with the underlying error printed.
 */

// `pg` is CommonJS; the standalone bundle drops its ESM entry. Load via
// createRequire so we resolve to ./lib/index.js (the CJS main) regardless of
// what the tracer kept around.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const { drizzle } = require("drizzle-orm/node-postgres");
const { migrate } = require("drizzle-orm/node-postgres/migrator");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
const db = drizzle(pool);

try {
  console.log("[migrate] applying pending migrations from ./drizzle");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[migrate] done");
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error("[migrate] failed:", err instanceof Error ? err.message : err);
  await pool.end().catch(() => {});
  process.exit(1);
}
