#!/usr/bin/env node
/**
 * bootstrap-runtime.mjs — first-boot workspace + admin bootstrap for Docker
 * self-host installs.
 *
 * Mirrors `bootstrapSelfHosted` (src/lib/workspace/bootstrap.ts) but runs as a
 * standalone .mjs against `pg`, so the runner stage doesn't need tsx, the TS
 * toolchain, or the Next bundle. Idempotent: short-circuits when any workspace
 * already exists.
 *
 * SISTER FILE — DRIFT WARNING:
 *   `scripts/bootstrap-self-hosted.ts` is the host-side equivalent
 *   (`pnpm bootstrap`) that uses Drizzle + the shared `bootstrapSelfHosted`
 *   helper in src/lib/workspace/bootstrap.ts. Any schema change to
 *   workspaces / workspace_members / brands / brand_members MUST be mirrored
 *   in BOTH files, or `pnpm bootstrap` and `docker compose up` will create
 *   subtly different DB states. The end-to-end docker-compose-up regression
 *   in specs/self-host-docker catches divergence at the integration level.
 *
 * Environment:
 *   DATABASE_URL    — required, TCP Postgres DSN
 *   WORKSPACE_NAME  — required when no workspace exists
 *   ADMIN_EMAIL     — required when no workspace exists
 *
 * On a database with no workspace and missing WORKSPACE_NAME/ADMIN_EMAIL the
 * script exits 2 with an actionable error (FR-005 — no half-bootstrap).
 *
 * Invoked by `docker-entrypoint.sh` after migrations succeed.
 */

// `pg` is CommonJS; the standalone bundle drops its ESM entry. Load via
// createRequire so we resolve to ./lib/index.js (the CJS main) regardless of
// what the tracer kept around.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[bootstrap] DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

function slugifyWorkspaceName(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "workspace"
  );
}

function personalSlug(userId) {
  return `personal-${userId.replace(/-/g, "").slice(0, 8)}`;
}

async function uniqueWorkspaceSlug(client, seed) {
  const baseSlug = seed || "workspace";
  let candidate = baseSlug;
  let i = 1;
  while (true) {
    const { rows } = await client.query(
      "select id from workspaces where slug = $1 limit 1",
      [candidate]
    );
    if (rows.length === 0) return candidate;
    i += 1;
    candidate = `${baseSlug}-${i}`;
    if (i > 1000) {
      throw new Error(
        `Could not allocate a unique workspace slug from "${seed}"`
      );
    }
  }
}

async function main() {
  const client = await pool.connect();
  try {
    // Idempotency gate (matches existing bootstrap-self-hosted.ts behavior).
    const existing = await client.query(
      "select id, name, slug from workspaces limit 1"
    );
    if (existing.rows.length > 0) {
      const ws = existing.rows[0];
      console.log(
        `[bootstrap] workspace already exists: ${ws.name} (${ws.slug}) — skipping`
      );
      return;
    }

    const workspaceName = (process.env.WORKSPACE_NAME ?? "").trim();
    const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
    if (!workspaceName || !adminEmail) {
      console.error(
        "[bootstrap] no workspace exists yet, and WORKSPACE_NAME / ADMIN_EMAIL are not set."
      );
      console.error(
        "[bootstrap] set both in your .env (or compose env_file) and restart the container."
      );
      console.error(
        "[bootstrap]   WORKSPACE_NAME=Acme"
      );
      console.error(
        "[bootstrap]   ADMIN_EMAIL=admin@acme.com"
      );
      // Distinct exit code so the entrypoint can recognize "config missing"
      // vs "real failure"; both are non-zero so the container won't start.
      process.exit(2);
    }

    await client.query("begin");

    // Ensure the admin user exists.
    let adminId;
    const userLookup = await client.query(
      "select id from users where email = $1 limit 1",
      [adminEmail]
    );
    if (userLookup.rows.length > 0) {
      adminId = userLookup.rows[0].id;
    } else {
      const userInsert = await client.query(
        "insert into users (email, role) values ($1, $2) returning id",
        [adminEmail, "admin"]
      );
      adminId = userInsert.rows[0].id;
    }

    // Allocate workspace slug.
    const slug = await uniqueWorkspaceSlug(
      client,
      slugifyWorkspaceName(workspaceName)
    );

    // Create workspace.
    const workspaceInsert = await client.query(
      `insert into workspaces (name, slug, mode, created_by)
       values ($1, $2, 'self_hosted', $3)
       returning id, slug`,
      [workspaceName, slug, adminId]
    );
    const workspaceId = workspaceInsert.rows[0].id;

    // Add admin as workspace owner.
    await client.query(
      `insert into workspace_members (workspace_id, user_id, role)
       values ($1, $2, 'owner')
       on conflict do nothing`,
      [workspaceId, adminId]
    );

    // Create the admin's Personal brand if it doesn't exist.
    const brandLookup = await client.query(
      `select id from brands
       where workspace_id = $1 and is_personal = true and owner_id = $2
       limit 1`,
      [workspaceId, adminId]
    );
    let personalBrandId;
    if (brandLookup.rows.length > 0) {
      personalBrandId = brandLookup.rows[0].id;
    } else {
      const brandInsert = await client.query(
        `insert into brands (workspace_id, name, slug, color, is_personal, owner_id, created_by)
         values ($1, 'Personal', $2, '#94a3b8', true, $3, $4)
         returning id`,
        [workspaceId, personalSlug(adminId), adminId, adminId]
      );
      personalBrandId = brandInsert.rows[0].id;

      await client.query(
        `insert into brand_members (brand_id, user_id, role)
         values ($1, $2, 'creator')
         on conflict do nothing`,
        [personalBrandId, adminId]
      );
    }

    await client.query("commit");

    console.log(
      `[bootstrap] created workspace ${workspaceName} (${slug}), admin ${adminEmail}, personal brand ${personalBrandId}`
    );
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

try {
  await main();
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(
    "[bootstrap] failed:",
    err instanceof Error ? err.message : err
  );
  await pool.end().catch(() => {});
  // Preserve specific exit code for missing-config case.
  if (process.exitCode && process.exitCode !== 0) {
    process.exit(process.exitCode);
  }
  process.exit(1);
}
