/**
 * GET /api/dev-login?email=<email> — DEV-ONLY login shortcut.
 *
 * Mints an authenticated session for the named user without going through
 * Google OAuth. Used exclusively by automated browser QA (`agent-browser`)
 * so end-to-end runs can skip the OAuth dance.
 *
 * --------------------------------------------------------------------------
 * SECURITY: defense-in-depth. ALL of these must hold:
 *
 *   1. `process.env.NODE_ENV !== "production"`  (this file is the gate)
 *   2. `process.env.DEV_LOGIN_ENABLED === "true"`  (env-flag must be set)
 *   3. `next.config.ts` aborts the build when both prod + flag are set
 *   4. `.env.example` documents the flag as dev-only and never set in prod
 *
 * If either runtime check fails, we return 404 (not 401) so the route is
 * invisible — a 401 would tell an attacker the route exists.
 *
 * Every successful mint emits a loud `[dev-login]` console.warn so a stray
 * activation in any environment is impossible to miss in logs.
 * --------------------------------------------------------------------------
 *
 * Behavior on the happy path:
 *   * Looks up the user by email (case-insensitive).
 *   * Inserts a fresh row in the `sessions` table with a 30-day expiry.
 *   * Sets the `authjs.session-token` cookie on the response (matching
 *     NextAuth's database-session cookie shape — httpOnly, sameSite=lax,
 *     path=/, secure=false on dev).
 *   * Redirects to `?next=` (default `/library`) so the test harness can
 *     navigate straight to the surface under test.
 *
 * Implementation note: we mirror NextAuth's database-session cookie format
 * exactly (cookie name `authjs.session-token`, opaque random token stored
 * verbatim in `sessions.session_token`). The `auth()` helper resolves the
 * session via the Drizzle adapter's `getSessionAndUser` so it transparently
 * works with the rest of the app — no special-casing in route handlers.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_NAME = "authjs.session-token";

/**
 * Combined gate. Returns `true` ONLY when both the runtime AND the explicit
 * env flag say dev-login is allowed. Anywhere this returns false the route
 * 404s — the gate is invisible to outsiders.
 */
function devLoginAllowed(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.DEV_LOGIN_ENABLED !== "true") return false;
  return true;
}

function notFound(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET(req: NextRequest) {
  if (!devLoginAllowed()) return notFound();

  const url = new URL(req.url);
  const emailRaw = url.searchParams.get("email");
  const next = url.searchParams.get("next") ?? "/library";

  if (!emailRaw || !emailRaw.includes("@")) {
    return NextResponse.json(
      { error: "missing_or_invalid_email" },
      { status: 400 }
    );
  }
  const email = emailRaw.trim().toLowerCase();

  // Case-insensitive email lookup. We don't auto-create — only seed users
  // get sessions, so a typo can't yield a usable login.
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (!user) {
    return NextResponse.json(
      { error: "user_not_found", email },
      { status: 404 }
    );
  }

  // Mint a fresh opaque session token. NextAuth's database-session shape
  // stores the cookie value verbatim as `session_token`; the adapter's
  // `getSessionAndUser` looks up the row by exact match.
  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + SESSION_TTL_MS);

  await db
    .insert(sessions)
    .values({
      sessionToken,
      userId: user.id,
      expires,
    })
    .onConflictDoNothing({ target: sessions.sessionToken });

  // Loud warning so the activation is unmissable in logs. We emit on EVERY
  // successful mint, including the test harness's repeated hits.
  console.warn(
    `[dev-login] session minted for user:${user.id} (${user.email}) — DEV ONLY. ` +
      `If you see this in production logs, an attacker has access to your env.`
  );

  // Redirect to the next URL with the session cookie set. Cookie shape
  // matches NextAuth's `defaultCookies(false).sessionToken` exactly (HTTP
  // dev — secure=false; in prod we'd be locked out by `devLoginAllowed`
  // anyway).
  const redirectUrl = new URL(next, url.origin);
  const res = NextResponse.redirect(redirectUrl);
  res.cookies.set({
    name: COOKIE_NAME,
    value: sessionToken,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: false,
    expires,
  });
  return res;
}
