/**
 * Campaign tagging — server-side contract tests.
 *
 * Two halves:
 *
 *   1. **GET /api/library shape** — the list endpoint now returns
 *      `campaigns: {id, name}[]` (was `string[]` of names). This is the bug
 *      fix the Designer flagged: the client needs both the uuid (for PATCH
 *      writes) and the name (for chip labels).
 *
 *   2. **POST /api/campaigns/[id]/assets** — bulk-add assets to a campaign.
 *      Validates that every asset belongs to the campaign's brand, dedupes
 *      via ON CONFLICT DO NOTHING, returns counts.
 *
 * Gate: `E2E_ENABLED=true`. Pure-shape assertions could run without the DB,
 * but we want to prove the actual select query lands the right column —
 * shape-only tests would have caught zero of the bugs we're fixing today.
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

describe("campaign tagging — library GET + bulk-add", () => {
  let userId: string;
  const insertedAssetIds: string[] = [];
  const insertedCampaignIds: string[] = [];

  beforeAll(async () => {
    if (!enabled) return;
    userId = await getUserId();
    sessionState.userId = userId;
  });

  afterAll(async () => {
    sessionState.userId = null;
    if (!enabled) return;
    const { db } = await import("@/lib/db");
    const { assets, assetCampaigns, campaigns } = await import(
      "@/lib/db/schema"
    );
    if (insertedAssetIds.length) {
      await db
        .delete(assetCampaigns)
        .where(inArray(assetCampaigns.assetId, insertedAssetIds));
      await db.delete(assets).where(inArray(assets.id, insertedAssetIds));
    }
    if (insertedCampaignIds.length) {
      await db
        .delete(campaigns)
        .where(inArray(campaigns.id, insertedCampaignIds));
    }
  });

  itOrSkip(
    "GET /api/library returns campaigns as {id, name}[] (not name strings)",
    async () => {
      const { db } = await import("@/lib/db");
      const { assets, assetCampaigns, brands, campaigns } = await import(
        "@/lib/db/schema"
      );
      const { GET: libraryGET } = await import("@/app/api/library/route");

      // We need a non-Personal brand for the campaign — Personal brands don't
      // get campaigns. Pick (or skip if none in this test DB).
      const [brand] = await db
        .select({ id: brands.id })
        .from(brands)
        .where(eq(brands.isPersonal, false))
        .limit(1);
      if (!brand) {
        console.warn("No non-personal brand available; skipping shape test.");
        return;
      }

      const [campaign] = await db
        .insert(campaigns)
        .values({
          brandId: brand.id,
          name: `tagshape-${Date.now()}`,
          createdBy: userId,
        })
        .returning({ id: campaigns.id, name: campaigns.name });
      insertedCampaignIds.push(campaign.id);

      const [asset] = await db
        .insert(assets)
        .values({
          userId,
          brandId: brand.id,
          source: "uploaded",
          mediaType: "image",
          model: "test",
          provider: "test",
          prompt: "campaign-shape-test",
          fileName: `tagshape-${Date.now()}.png`,
          r2Key: "test/tagshape.png",
          r2Url: "https://example/tagshape.png",
        })
        .returning({ id: assets.id });
      insertedAssetIds.push(asset.id);
      await db.insert(assetCampaigns).values({
        assetId: asset.id,
        campaignId: campaign.id,
      });

      const req = new Request(
        `http://localhost/api/library?brand=${brand.id}&limit=200`
      );
      const res = await libraryGET(
        req as unknown as Parameters<typeof libraryGET>[0]
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        items: Array<{
          id: string;
          campaigns: Array<{ id: string; name: string }>;
        }>;
      };
      const found = data.items.find((it) => it.id === asset.id);
      expect(found).toBeDefined();
      // Critical assertion: the shape is `{id, name}`, not bare strings.
      expect(found!.campaigns).toEqual([
        { id: campaign.id, name: campaign.name },
      ]);
    }
  );

  itOrSkip(
    "POST /api/campaigns/[id]/assets bulk-attaches and dedupes",
    async () => {
      const { db } = await import("@/lib/db");
      const { assets, brands, campaigns } = await import("@/lib/db/schema");
      const { POST: attachPOST } = await import(
        "@/app/api/campaigns/[id]/assets/route"
      );

      const [brand] = await db
        .select({ id: brands.id })
        .from(brands)
        .where(eq(brands.isPersonal, false))
        .limit(1);
      if (!brand) {
        console.warn("No non-personal brand available; skipping bulk-add test.");
        return;
      }

      const [campaign] = await db
        .insert(campaigns)
        .values({
          brandId: brand.id,
          name: `bulkadd-${Date.now()}`,
          createdBy: userId,
        })
        .returning({ id: campaigns.id });
      insertedCampaignIds.push(campaign.id);

      // Three assets on the same brand.
      const seedAssets = [];
      for (let i = 0; i < 3; i++) {
        const [a] = await db
          .insert(assets)
          .values({
            userId,
            brandId: brand.id,
            source: "uploaded",
            mediaType: "image",
            model: "test",
            provider: "test",
            prompt: `bulk-add-${i}`,
            fileName: `bulkadd-${Date.now()}-${i}.png`,
            r2Key: `test/bulkadd-${i}.png`,
            r2Url: `https://example/bulkadd-${i}.png`,
          })
          .returning({ id: assets.id });
        seedAssets.push(a.id);
      }
      insertedAssetIds.push(...seedAssets);

      // First call: 3 inserts.
      const req1 = new Request(
        `http://localhost/api/campaigns/${campaign.id}/assets`,
        {
          method: "POST",
          body: JSON.stringify({ assetIds: seedAssets }),
        }
      );
      const res1 = await attachPOST(
        req1 as unknown as Parameters<typeof attachPOST>[0],
        { params: Promise.resolve({ id: campaign.id }) }
      );
      expect(res1.status).toBe(200);
      const data1 = (await res1.json()) as {
        requested: number;
        inserted: number;
        skipped: number;
      };
      expect(data1).toEqual({ requested: 3, inserted: 3, skipped: 0 });

      // Second call with the same ids: all skipped.
      const req2 = new Request(
        `http://localhost/api/campaigns/${campaign.id}/assets`,
        {
          method: "POST",
          body: JSON.stringify({ assetIds: seedAssets }),
        }
      );
      const res2 = await attachPOST(
        req2 as unknown as Parameters<typeof attachPOST>[0],
        { params: Promise.resolve({ id: campaign.id }) }
      );
      expect(res2.status).toBe(200);
      const data2 = (await res2.json()) as {
        requested: number;
        inserted: number;
        skipped: number;
      };
      expect(data2).toEqual({ requested: 3, inserted: 0, skipped: 3 });
    }
  );

  itOrSkip(
    "POST /api/campaigns/[id]/assets rejects cross-brand asset ids",
    async () => {
      const { db } = await import("@/lib/db");
      const { assets, brands, campaigns } = await import("@/lib/db/schema");
      const { POST: attachPOST } = await import(
        "@/app/api/campaigns/[id]/assets/route"
      );

      // Two brands so we can create the cross-brand condition.
      const brandRows = await db
        .select({ id: brands.id, isPersonal: brands.isPersonal })
        .from(brands)
        .where(eq(brands.isPersonal, false))
        .limit(2);
      if (brandRows.length < 2) {
        console.warn("Need ≥2 non-personal brands; skipping cross-brand test.");
        return;
      }
      const [brandA, brandB] = brandRows;

      const [campaign] = await db
        .insert(campaigns)
        .values({
          brandId: brandA.id,
          name: `xbrand-${Date.now()}`,
          createdBy: userId,
        })
        .returning({ id: campaigns.id });
      insertedCampaignIds.push(campaign.id);

      // One asset on brand B (the wrong brand).
      const [foreignAsset] = await db
        .insert(assets)
        .values({
          userId,
          brandId: brandB.id,
          source: "uploaded",
          mediaType: "image",
          model: "test",
          provider: "test",
          prompt: "foreign",
          fileName: `xbrand-${Date.now()}.png`,
          r2Key: "test/xbrand.png",
          r2Url: "https://example/xbrand.png",
        })
        .returning({ id: assets.id });
      insertedAssetIds.push(foreignAsset.id);

      const req = new Request(
        `http://localhost/api/campaigns/${campaign.id}/assets`,
        {
          method: "POST",
          body: JSON.stringify({ assetIds: [foreignAsset.id] }),
        }
      );
      const res = await attachPOST(
        req as unknown as Parameters<typeof attachPOST>[0],
        { params: Promise.resolve({ id: campaign.id }) }
      );
      expect(res.status).toBe(400);
      const data = (await res.json()) as {
        error: string;
        invalidIds: string[];
      };
      expect(data.error).toBe("asset_brand_mismatch");
      expect(data.invalidIds).toContain(foreignAsset.id);
    }
  );
});
