/**
 * /api/health — liveness + DB-readiness probe.
 *
 * Used by:
 *   - Dockerfile HEALTHCHECK (busybox wget)
 *   - docker-compose.yml app service healthcheck
 *   - any external orchestrator
 *
 * Returns 200 + `{ ok: true, version }` when the database accepts a trivial
 * SELECT 1 round-trip, 503 + `{ ok: false }` when it fails. The response
 * body is intentionally minimal — `pg` error messages echo the connecting
 * username (e.g. `password authentication failed for user "cauldron"`),
 * which is reconnaissance fuel for an unauthenticated endpoint. The full
 * error is logged server-side so operators can read it from
 * `docker compose logs app`.
 *
 * No auth — proxy.ts allowlists this path so the orchestrator probe (which
 * has no session cookie) can reach it.
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json(
      { ok: true, version: process.env.NEXT_PUBLIC_APP_VERSION ?? null },
      { status: 200 }
    );
  } catch (err) {
    // Log the real error for operators; never echo it to the public.
    console.error("[health] db check failed:", err);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
