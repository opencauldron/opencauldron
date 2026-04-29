import { notFound, redirect } from "next/navigation";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
import type {
  BrandOption,
  CampaignOption,
  TagOption,
} from "./filter-bar";

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

  // First page: read directly from drizzle to keep TTFB tight. Cursor
  // pagination is `(createdAt, id)` lexicographic so sub-millisecond inserts
  // can't cause duplicates or skips.
  //
  // We additionally compute the total count via a window function so the
  // FilterBar's summary can show "N results" without a second round-trip.
  const initialRows = await db
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
      totalCount: sql<number>`COUNT(*) OVER()`.as("total_count"),
    })
    .from(assets)
    .where(and(eq(assets.userId, userId)))
    .orderBy(desc(assets.createdAt), desc(assets.id))
    .limit(INITIAL_LIMIT + 1);

  const hasMore = initialRows.length > INITIAL_LIMIT;
  const trimmed = hasMore ? initialRows.slice(0, INITIAL_LIMIT) : initialRows;
  const ids = trimmed.map((r) => r.id);
  const initialTotal = trimmed[0]?.totalCount ?? 0;

  // Tags + campaigns for the loaded items, in two batched queries.
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

  // Resolve thumbnail + full URLs once.
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

  // -----------------------------------------------------------------------
  // FilterBar option lists. All scoped to the user's owned brands so the
  // facets only show choices that actually appear in their library.
  //
  // Run these in parallel — each is a single index hit, total ~four cheap
  // round-trips that overlap with the asset hydration above.
  // -----------------------------------------------------------------------
  const [
    brandRows,
    facetCampaignRows,
    facetTagRows,
    distinctStatusRows,
  ] = await Promise.all([
    db
      .select({
        id: brands.id,
        name: brands.name,
        color: brands.color,
        isPersonal: brands.isPersonal,
        anchorAssetIds: brands.anchorAssetIds,
      })
      .from(brands)
      .where(eq(brands.ownerId, userId)),
    // Campaigns whose brand is owned by this user.
    db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        brandId: campaigns.brandId,
      })
      .from(campaigns)
      .innerJoin(brands, eq(brands.id, campaigns.brandId))
      .where(eq(brands.ownerId, userId))
      .orderBy(campaigns.name),
    // Distinct tag names the user has on any of their assets.
    db
      .selectDistinct({ tag: assetTags.tag })
      .from(assetTags)
      .innerJoin(assets, eq(assets.id, assetTags.assetId))
      .where(eq(assets.userId, userId))
      .orderBy(assetTags.tag),
    // Distinct status values across the user's assets — used to gate the
    // Status section in the More popover. We hide it when only one value
    // exists so solo creators don't see a useless control.
    db
      .selectDistinct({ status: assets.status })
      .from(assets)
      .where(eq(assets.userId, userId)),
  ]);

  const initialBrands = brandRows.map((b) => ({
    id: b.id,
    name: b.name,
    color: b.color,
    isPersonal: b.isPersonal,
    anchorAssetIds: (b.anchorAssetIds ?? []) as string[],
  }));

  const facetBrands: BrandOption[] = brandRows
    .map((b) => ({ id: b.id, name: b.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const facetCampaigns: CampaignOption[] = facetCampaignRows.map((c) => ({
    id: c.id,
    name: c.name,
    brandId: c.brandId,
  }));

  const facetTags: TagOption[] = facetTagRows.map((r) => ({
    id: r.tag,
    label: r.tag,
  }));

  const hasMixedStatuses = distinctStatusRows.length > 1;

  const initialNextCursor = hasMore
    ? `${trimmed[trimmed.length - 1].createdAt.toISOString()}__${trimmed[trimmed.length - 1].id}`
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
        initialTotal={initialTotal}
        initialBrands={initialBrands}
        facetBrands={facetBrands}
        facetCampaigns={facetCampaigns}
        facetTags={facetTags}
        hasMixedStatuses={hasMixedStatuses}
      />
    </div>
  );
}
