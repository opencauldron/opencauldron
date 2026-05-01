/**
 * Unit tests for the dev-login route's env-gate (`/api/dev-login`).
 *
 * The happy path requires real DB access (it inserts into the `sessions`
 * table) and is exercised by the agent-browser QA walkthrough. These unit
 * tests cover the security-critical guardrails: BOTH env checks must be
 * true for the route to do anything; either one missing returns 404.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const URL_BASE = "http://localhost:9999/api/dev-login?email=anyone@example.com";

function makeReq(): NextRequest {
  return new Request(URL_BASE, { method: "GET" }) as unknown as NextRequest;
}

beforeEach(() => {
  // Default to a known-bad combination so a forgotten setter doesn't leak.
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DEV_LOGIN_ENABLED", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dev-login route — gate", () => {
  it("returns 404 when NODE_ENV=production even with the flag on", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_LOGIN_ENABLED", "true");

    const { GET } = await import("@/app/api/dev-login/route");
    const res = await GET(makeReq());
    expect(res.status).toBe(404);
  });

  it("returns 404 when DEV_LOGIN_ENABLED is unset even in dev", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_LOGIN_ENABLED", undefined as unknown as string);

    const { GET } = await import("@/app/api/dev-login/route");
    const res = await GET(makeReq());
    expect(res.status).toBe(404);
  });

  it("returns 404 when DEV_LOGIN_ENABLED='false'", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_LOGIN_ENABLED", "false");

    const { GET } = await import("@/app/api/dev-login/route");
    const res = await GET(makeReq());
    expect(res.status).toBe(404);
  });

  it("returns 404 when DEV_LOGIN_ENABLED='1' (not the literal 'true')", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_LOGIN_ENABLED", "1");

    const { GET } = await import("@/app/api/dev-login/route");
    const res = await GET(makeReq());
    expect(res.status).toBe(404);
  });

  it("does NOT return 404 when both env checks pass (proves the gate's polarity)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_LOGIN_ENABLED", "true");

    const { GET } = await import("@/app/api/dev-login/route");
    // Without an `email` query param the route hits the 400 path — that
    // confirms the gate let the request through. Anything other than 404
    // would also pass this assertion; we tighten to 400 because a 5xx
    // would mean we accidentally broke the body of the handler.
    const res = await GET(
      new Request("http://localhost:9999/api/dev-login", {
        method: "GET",
      }) as unknown as NextRequest
    );
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(400);
  });
});
