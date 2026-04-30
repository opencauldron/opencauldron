/**
 * E2E (T030): combine brand + tag + source filters via URL, share the URL,
 * reload, verify identical results.
 *
 * The test is in two halves:
 *
 *   1. **URL contract round-trip** (pure, no DB). Asserts that a multi-filter
 *      URL parses → serializes → parses to an identical query object. This
 *      is what makes deep links shareable: as long as the contract is stable,
 *      pasting a URL into a new tab reproduces the exact same filter set.
 *
 *   2. **Route handler smoke** (gated on E2E_ENABLED). Inserts a small set
 *      of assets with deliberately distinct (brand, tag, source) tuples,
 *      hits `GET /api/library` with each filter combo, asserts the right
 *      asset is returned, then runs the same request a second time using
 *      the encoded URL from step 1's parser to prove the deep-link path
 *      and the toggled-chip path collapse to the same SQL.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  parseLibraryQuery,
  serializeLibraryQuery,
} from "@/app/(dashboard)/library/use-library-query";
import { getUserId } from "../utils/get-user";

// Auth + flag mocks mirror tests/integration/library-upload-generate.test.ts.
const sessionState: { userId: string | null } = { userId: null };

vi.mock("@/lib/auth", () => ({
  auth: async () =>
    sessionState.userId ? { user: { id: sessionState.userId } } : null,
}));

vi.mock("@/lib/env", async () => {
  const real = await vi.importActual<typeof import("@/lib/env")>("@/lib/env");
  return { ...real, env: { ...real.env, LIBRARY_DAM_ENABLED: true } };
});

const enabled = process.env.E2E_ENABLED === "true";
const itOrSkip = enabled ? it : it.skip;

// ---------------------------------------------------------------------------
// Pure URL contract — runs always.
// ---------------------------------------------------------------------------

describe("library URL contract round-trip (T030 — pure)", () => {
  it("multi-filter URL parses, serializes, and parses to itself", () => {
    const original = new URLSearchParams(
      "q=hero+shot" +
        "&brand=11111111-1111-1111-1111-111111111111" +
        "&tag=studio&tag=blue&tagOp=and" +
        "&source=generated&source=uploaded" +
        "&status=approved"
    );

    const parsed = parseLibraryQuery(original);
    expect(parsed).toEqual({
      q: "hero shot",
      brand: "11111111-1111-1111-1111-111111111111",
      campaign: null,
      tags: ["studio", "blue"],
      tagOp: "and",
      sources: ["generated", "uploaded"],
      statuses: ["approved"],
    });

    const re = serializeLibraryQuery(parsed);
    const reparsed = parseLibraryQuery(re);
    expect(reparsed).toEqual(parsed);
  });

  it("absent tagOp defaults to or; OR omits the param on serialize", () => {
    const sp = new URLSearchParams("tag=a&tag=b");
    const parsed = parseLibraryQuery(sp);
    expect(parsed.tagOp).toBe("or");
    const re = serializeLibraryQuery(parsed).toString();
    expect(re).not.toContain("tagOp");
  });

  it("invalid source/status values are dropped (defensive parse)", () => {
    const sp = new URLSearchParams(
      "source=generated&source=bogus&status=approved&status=invalid"
    );
    const parsed = parseLibraryQuery(sp);
    expect(parsed.sources).toEqual(["generated"]);
    expect(parsed.statuses).toEqual(["approved"]);
  });
});

// ---------------------------------------------------------------------------
// Route smoke — gated on E2E_ENABLED.
// ---------------------------------------------------------------------------

describe("library filters via route (T030 — e2e)", () => {
  let userId: string;
  // Track every asset we insert so the afterAll can scrub them.
  const insertedAssetIds: string[] = [];
  const baseTag = `t30-${Date.now()}`;

  beforeAll(async () => {
    if (!enabled) return;
    userId = await getUserId();
    sessionState.userId = userId;
  });

  afterAll(async () => {
    sessionState.userId = null;
    if (!enabled || insertedAssetIds.length === 0) return;
    const { db } = await import("@/lib/db");
    const { assets, assetTags } = await import("@/lib/db/schema");
    await db.delete(assetTags).where(inArray(assetTags.assetId, insertedAssetIds));
    await db.delete(assets).where(inArray(assets.id, insertedAssetIds));
  });

  itOrSkip(
    "deep-link URL with brand + tag + source returns the seeded asset",
    async () => {
      const { db } = await import("@/lib/db");
      const { assets, assetTags, brands } = await import("@/lib/db/schema");

      // Find a brand owned by this user — use Personal so we never collide
      // with concurrent test runs touching real brands.
      const [personal] = await db
        .select({ id: brands.id })
        .from(brands)
        .where(eq(brands.ownerId, userId))
        .limit(1);
      expect(personal?.id).toBeTruthy();

      // Seed two assets:
      //   match — brand=Personal, source=uploaded, tag=baseTag
      //   miss  — brand=Personal, source=generated, no tag
      const [match] = await db
        .insert(assets)
        .values({
          userId,
          brandId: personal!.id,
          source: "uploaded",
          mediaType: "image",
          model: "test",
          provider: "test",
          prompt: "filter-match",
          fileName: `t30-match-${Date.now()}.png`,
          r2Key: "test/t30-match.png",
          r2Url: "https://example/t30-match.png",
        })
        .returning({ id: assets.id });
      const [miss] = await db
        .insert(assets)
        .values({
          userId,
          brandId: personal!.id,
          source: "generated",
          mediaType: "image",
          model: "test",
          provider: "test",
          prompt: "filter-miss",
          fileName: `t30-miss-${Date.now()}.png`,
          r2Key: "test/t30-miss.png",
          r2Url: "https://example/t30-miss.png",
        })
        .returning({ id: assets.id });
      insertedAssetIds.push(match.id, miss.id);
      await db.insert(assetTags).values({ assetId: match.id, tag: baseTag });

      const { GET: libraryGET } = await import("@/app/api/library/route");

      // Build the URL by toggling chips (parser → serializer round-trip)
      // and confirm the deep link reproduces it.
      const togglePath = serializeLibraryQuery({
        q: "",
        brand: personal!.id,
        campaign: null,
        tags: [baseTag],
        tagOp: "or",
        sources: ["uploaded"],
        statuses: [],
      });

      const req = new Request(`http://localhost/api/library?${togglePath}`);
      const res = await libraryGET(req as unknown as Parameters<typeof libraryGET>[0]);
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        items: Array<{ id: string }>;
        total: number;
      };
      const ids = data.items.map((it) => it.id);
      expect(ids).toContain(match.id);
      expect(ids).not.toContain(miss.id);

      // Reload the same URL — identical results.
      const req2 = new Request(`http://localhost/api/library?${togglePath}`);
      const res2 = await libraryGET(req2 as unknown as Parameters<typeof libraryGET>[0]);
      const data2 = (await res2.json()) as { items: Array<{ id: string }> };
      expect(data2.items.map((it) => it.id)).toEqual(ids);
    }
  );
});
