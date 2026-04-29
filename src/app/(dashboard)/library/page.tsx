import { notFound, redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  assets,
  assetCampaigns,
  assetTags,
  brands,
  campaigns,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getAssetUrl } from "@/lib/storage";
import { LibraryClient, type LibraryAsset } from "./library-client";

const INITIAL_LIMIT = 30;

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  if (!env.LIBRARY_DAM_ENABLED) {
    notFound();
  }

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const userId = session.user.id;

  // First page: read directly from drizzle to keep TTFB tight (mirrors the
  // server-side path the backend agent's GET /api/library will take). Cursor
  // pagination is `createdAt` strictly less-than (matches the references API
  // contract the picker already consumes).
  const rows = await db
    .select({
      id: assets.id,
      userId: assets.userId,
      brandId: assets.brandId,
      source: assets.source,
      mediaType: assets.mediaType,
      r2Key: assets.r2Key,
      r2Url: assets.r2Url,
      thumbnailR2Key: assets.thumbnailR2Key,
      fileName: assets.fileName,
      fileSize: assets.fileSize,
      width: assets.width,
      height: assets.height,
      usageCount: assets.usageCount,
      embeddedAt: assets.embeddedAt,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .where(and(eq(assets.userId, userId)))
    .orderBy(desc(assets.createdAt), desc(assets.id))
    .limit(INITIAL_LIMIT + 1);

  const hasMore = rows.length > INITIAL_LIMIT;
  const trimmed = hasMore ? rows.slice(0, INITIAL_LIMIT) : rows;
  const ids = trimmed.map((r) => r.id);

  // Tags + campaigns in two follow-up batched queries — cheap because we
  // already have the asset id set in memory.
  const [tagRows, campaignRows] = await Promise.all([
    ids.length
      ? db
          .select({ assetId: assetTags.assetId, tag: assetTags.tag })
          .from(assetTags)
          .where(inArray(assetTags.assetId, ids))
      : Promise.resolve([] as { assetId: string; tag: string }[]),
    ids.length
      ? db
          .select({
            assetId: assetCampaigns.assetId,
            campaignId: assetCampaigns.campaignId,
            campaignName: campaigns.name,
          })
          .from(assetCampaigns)
          .innerJoin(campaigns, eq(campaigns.id, assetCampaigns.campaignId))
          .where(inArray(assetCampaigns.assetId, ids))
      : Promise.resolve(
          [] as { assetId: string; campaignId: string; campaignName: string }[]
        ),
  ]);

  const tagsById = new Map<string, string[]>();
  for (const row of tagRows) {
    const list = tagsById.get(row.assetId) ?? [];
    list.push(row.tag);
    tagsById.set(row.assetId, list);
  }
  const campaignsById = new Map<string, string[]>();
  for (const row of campaignRows) {
    const list = campaignsById.get(row.assetId) ?? [];
    list.push(row.campaignName);
    campaignsById.set(row.assetId, list);
  }

  // Resolve thumbnail + full URLs once — Cloudflare R2 keys → signed URLs.
  const initialItems: LibraryAsset[] = await Promise.all(
    trimmed.map(async (r) => {
      const url = await getAssetUrl(r.r2Key);
      const thumbnailUrl = r.thumbnailR2Key
        ? await getAssetUrl(r.thumbnailR2Key)
        : url;
      return {
        id: r.id,
        userId: r.userId,
        brandId: r.brandId,
        source: r.source,
        mediaType: r.mediaType,
        url,
        thumbnailUrl,
        fileName: r.fileName,
        fileSize: r.fileSize,
        width: r.width,
        height: r.height,
        usageCount: r.usageCount,
        embeddedAt: r.embeddedAt ? r.embeddedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        tags: tagsById.get(r.id) ?? [],
        campaigns: campaignsById.get(r.id) ?? [],
      };
    })
  );

  // Brand list for the pin-to-brand toggle in the detail panel. Cheap because
  // we own the workspace lookup already; reuse the same scoping the layout
  // uses (own-personal-or-real-brand). Fetched here so the panel doesn't have
  // to round-trip on first open.
  const brandRows = await db
    .select({
      id: brands.id,
      name: brands.name,
      color: brands.color,
      isPersonal: brands.isPersonal,
      anchorAssetIds: brands.anchorAssetIds,
    })
    .from(brands)
    .where(eq(brands.ownerId, userId));

  const initialBrands = brandRows.map((b) => ({
    id: b.id,
    name: b.name,
    color: b.color,
    isPersonal: b.isPersonal,
    anchorAssetIds: (b.anchorAssetIds ?? []) as string[],
  }));

  const initialNextCursor = hasMore
    ? trimmed[trimmed.length - 1].createdAt.toISOString()
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Library</h1>
        <p className="text-muted-foreground mt-1">
          Every upload, generation, and import — in one place. Tag, pin, and
          reuse.
        </p>
      </div>
      <LibraryClient
        initialItems={initialItems}
        initialNextCursor={initialNextCursor}
        initialBrands={initialBrands}
      />
    </div>
  );
}
