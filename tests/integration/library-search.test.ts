/**
 * E2E (T031): full-text search by partial filename and partial tag name.
 *
 * Phase 2 already shipped the `tags_text` denormalized column maintained by
 * a trigger on `asset_tags` plus a generated `search_vector tsvector`. This
 * test asserts the API surface (T025) wires that plumbing through correctly:
 *
 *   - Seeded asset A has `file_name = 'hero-shot-001.png'`, no tags.
 *   - Seeded asset B has `file_name = 'plain.png'`, tag = `hero-spring`.
 *   - Both should match `q=hero` because `search_vector` covers file_name +
 *     prompt + tags_text.
 *   - Ordering: ts_rank gives a deterministic ranking; we verify both come
 *     back, scoped to the test user.
 *
 * Gated on E2E_ENABLED so non-DB CI runs self-skip.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getUserId } from "../utils/get-user";

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

describe("library FTS via /api/library?q=… (T031)", () => {
  let userId: string;
  const insertedAssetIds: string[] = [];
  const stamp = Date.now();
  // Use a unique substring that won't collide with anything else in the user's
  // library — the test asserts equality against a precise expectation.
  const needle = `t31qry${stamp}`;

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
    "matches filenames AND tag names (tsvector covers both)",
    async () => {
      const { db } = await import("@/lib/db");
      const { assets, assetTags, brands } = await import("@/lib/db/schema");

      const [personal] = await db
        .select({ id: brands.id })
        .from(brands)
        .where(eq(brands.ownerId, userId))
        .limit(1);
      expect(personal?.id).toBeTruthy();

      // Asset A — needle is in file_name only.
      const [a] = await db
        .insert(assets)
        .values({
          userId,
          brandId: personal!.id,
          source: "uploaded",
          mediaType: "image",
          model: "test",
          provider: "test",
          prompt: "blank",
          fileName: `${needle}-shot-001.png`,
          r2Key: `test/${needle}-a.png`,
          r2Url: `https://example/${needle}-a.png`,
        })
        .returning({ id: assets.id });

      // Asset B — needle is in tag only.
      const [b] = await db
        .insert(assets)
        .values({
          userId,
          brandId: personal!.id,
          source: "generated",
          mediaType: "image",
          model: "test",
          provider: "test",
          prompt: "blank",
          fileName: "plain.png",
          r2Key: `test/${needle}-b.png`,
          r2Url: `https://example/${needle}-b.png`,
        })
        .returning({ id: assets.id });

      insertedAssetIds.push(a.id, b.id);

      // Insert the tag — the trigger updates tags_text + search_vector.
      await db.insert(assetTags).values({ assetId: b.id, tag: `${needle}-tag` });

      // Asset C — should NOT match (no needle anywhere).
      const [c] = await db
        .insert(assets)
        .values({
          userId,
          brandId: personal!.id,
          source: "generated",
          mediaType: "image",
          model: "test",
          provider: "test",
          prompt: "irrelevant",
          fileName: "noise.png",
          r2Key: `test/${needle}-c.png`,
          r2Url: `https://example/${needle}-c.png`,
        })
        .returning({ id: assets.id });
      insertedAssetIds.push(c.id);

      const { GET: libraryGET } = await import("@/app/api/library/route");

      // Search with the unique needle — both A and B should match.
      const url = `http://localhost/api/library?q=${encodeURIComponent(
        needle
      )}&limit=50`;
      const req = new Request(url);
      const res = await libraryGET(
        req as unknown as Parameters<typeof libraryGET>[0]
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        items: Array<{ id: string; fileName: string | null }>;
        total: number;
      };

      const ids = data.items.map((it) => it.id);
      expect(ids).toContain(a.id);
      expect(ids).toContain(b.id);
      expect(ids).not.toContain(c.id);
      expect(data.total).toBeGreaterThanOrEqual(2);
    }
  );
});
