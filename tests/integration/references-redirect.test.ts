/**
 * E2E (T024): legacy `/references` bookmarks resolve to `/library`.
 *
 * Spec FR-007 calls for a 301; Next.js's App Router exposes `redirect()`
 * (307) and `permanentRedirect()` (308). 308 is 301's modern semantic
 * equivalent (preserves method + body), so the page uses `permanentRedirect`
 * and this test asserts 308 plus query-string passthrough.
 *
 * `permanentRedirect()` throws a tagged Error whose `digest` field encodes
 * the destination + status — see `next/dist/client/components/redirect.js`.
 * Parsing the digest is the cheapest way to assert from a unit-style test
 * without spinning up a full HTTP server.
 */

import { describe, expect, it } from "vitest";
import ReferencesRedirectPage from "@/app/(dashboard)/references/page";

interface RedirectErrorShape {
  message?: string;
  digest?: string;
}

function parseDigest(digest: string) {
  // Shape: `NEXT_REDIRECT;<type>;<destination>;<statusCode>;`
  const parts = digest.split(";");
  const errorCode = parts[0];
  const type = parts[1];
  const destination = parts.slice(2, -2).join(";");
  const status = Number(parts.at(-2));
  return { errorCode, type, destination, status };
}

async function captureRedirect(
  searchParams: Record<string, string | string[] | undefined>
) {
  try {
    await ReferencesRedirectPage({
      searchParams: Promise.resolve(searchParams),
    });
    throw new Error("Expected redirect, got normal return");
  } catch (err) {
    const e = err as RedirectErrorShape;
    if (!e.digest || !e.digest.startsWith("NEXT_REDIRECT;")) {
      throw err;
    }
    return parseDigest(e.digest);
  }
}

describe("/references → /library redirect (T024 / FR-007)", () => {
  it("plain /references redirects to /library with 308", async () => {
    const { errorCode, destination, status } = await captureRedirect({});
    expect(errorCode).toBe("NEXT_REDIRECT");
    expect(destination).toBe("/library");
    expect(status).toBe(308);
  });

  it("/references?foo=bar preserves the query string", async () => {
    const { destination, status } = await captureRedirect({ foo: "bar" });
    expect(destination).toBe("/library?foo=bar");
    expect(status).toBe(308);
  });

  it("preserves multiple query params + array values", async () => {
    const { destination } = await captureRedirect({
      brand: "acme",
      tag: ["a", "b"],
    });
    // URLSearchParams round-trips ?brand=acme&tag=a&tag=b in some order; tag
    // entries are appended in input order so the array is stable.
    expect(destination.startsWith("/library?")).toBe(true);
    const params = new URL(`http://x${destination}`).searchParams;
    expect(params.get("brand")).toBe("acme");
    expect(params.getAll("tag")).toEqual(["a", "b"]);
  });

  it("ignores undefined query values without throwing", async () => {
    const { destination } = await captureRedirect({
      defined: "yes",
      missing: undefined,
    });
    expect(destination).toBe("/library?defined=yes");
  });
});
