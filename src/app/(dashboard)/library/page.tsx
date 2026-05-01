import { notFound, redirect } from "next/navigation";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  assets,
  assetCampaigns,
  assetTags,
  brands,
  brandMembers,
  campaigns,
  users,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getAssetUrl } from "@/lib/storage";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import { loadRoleContext, isWorkspaceAdmin } from "@/lib/workspace/permissions";
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

  // Workspace + admin context. Admins see every asset in the workspace;
  // members see only their own. Resolved up front so the same flag drives
  // the asset scope and the brand/campaign facet scope below.
  const workspace = await getCurrentWorkspace(userId);
  const isAdmin = workspace
    ? isWorkspaceAdmin(await loadRoleContext(userId, workspace.id))
    : false;

  // First page: read directly from drizzle to keep TTFB tight. Cursor
  // pagination is `(createdAt, id)` lexicographic so sub-millisecond inserts
  // can't cause duplicates or skips.
  //
  // We additionally compute the total count via a window function so the
  // FilterBar's summary can show "N results" without a second round-trip.
  const assetScope = isAdmin && workspace
    ? sql`${assets.brandId} IN (SELECT id FROM brands WHERE workspace_id = ${workspace.id})`
    : eq(assets.userId, userId);

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
      status: assets.status,
      embeddedAt: assets.embeddedAt,
      createdAt: assets.createdAt,
      creatorId: users.id,
      creatorName: users.name,
      creatorImage: users.image,
      creatorEmail: users.email,
      webpR2Key: assets.webpR2Key,
      webpFileSize: assets.webpFileSize,
      webpStatus: assets.webpStatus,
      originalMimeType: assets.originalMimeType,
      totalCount: sql<number>`COUNT(*) OVER()`.as("total_count"),
    })
    .from(assets)
    .leftJoin(users, eq(users.id, assets.userId))
    .where(assetScope)
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
      // Resolve all storage URLs in parallel — saves a round-trip when both
      // thumbnail and webp keys are present. Matches the pattern in the API
      // hydrator (`hydrateLibraryItem` in `src/app/api/library/lib.ts`).
      const [url, thumbnailUrl, webpUrl] = await Promise.all([
        getAssetUrl(r.r2Key),
        r.thumbnailR2Key ? getAssetUrl(r.thumbnailR2Key) : Promise.resolve(null),
        r.webpR2Key ? getAssetUrl(r.webpR2Key) : Promise.resolve(null),
      ]);
      return {
        id: r.id,
        userId: r.userId,
        brandId: r.brandId,
        source: r.source,
        mediaType: r.mediaType,
        url,
        thumbnailUrl: thumbnailUrl ?? url,
        fileName: r.fileName,
        fileSize: r.fileSize,
        width: r.width,
        height: r.height,
        usageCount: r.usageCount,
        status: r.status,
        creator: r.creatorId
          ? {
              id: r.creatorId,
              name: r.creatorName,
              image: r.creatorImage,
              email: r.creatorEmail,
            }
          : null,
        embeddedAt: r.embeddedAt ? r.embeddedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        tags: tagsById.get(r.id) ?? [],
        campaigns: campaignsById.get(r.id) ?? [],
        webpUrl,
        webpFileSize: r.webpFileSize,
        webpStatus: r.webpStatus,
        originalMimeType: r.originalMimeType,
        originalFileSize: r.fileSize,
      };
    })
  );

  // -----------------------------------------------------------------------
  // FilterBar option lists. Brands + campaigns are scoped to the active
  // workspace using the same rules as the sidebar's BrandList: workspace
  // admins see every brand in the workspace, members see only the brands
  // they belong to via brand_members. This keeps the Brand facet in sync
  // with what the user already sees in the sidebar.
  //
  // Run these in parallel — each is a single index hit, total ~four cheap
  // round-trips that overlap with the asset hydration above.
  // -----------------------------------------------------------------------
  // For personal brands we surface the owner's identity (name + avatar) so an
  // admin viewing several teammates' personal libraries can tell them apart.
  // The user join is LEFT so non-personal brands (no ownerId) still come back.
  const brandSelect = {
    id: brands.id,
    name: brands.name,
    color: brands.color,
    isPersonal: brands.isPersonal,
    ownerId: brands.ownerId,
    ownerName: users.name,
    ownerImage: users.image,
    ownerEmail: users.email,
    anchorAssetIds: brands.anchorAssetIds,
  } as const;

  type BrandRow = {
    id: string;
    name: string;
    color: string;
    isPersonal: boolean;
    ownerId: string | null;
    ownerName: string | null;
    ownerImage: string | null;
    ownerEmail: string | null;
    anchorAssetIds: unknown;
  };

  const brandsQuery: Promise<BrandRow[]> = !workspace
    ? Promise.resolve([])
    : isAdmin
    ? db
        .select(brandSelect)
        .from(brands)
        .leftJoin(users, eq(users.id, brands.ownerId))
        .where(eq(brands.workspaceId, workspace.id))
        .orderBy(brands.name)
    : db
        .select(brandSelect)
        .from(brands)
        .innerJoin(brandMembers, eq(brandMembers.brandId, brands.id))
        .leftJoin(users, eq(users.id, brands.ownerId))
        .where(
          and(
            eq(brands.workspaceId, workspace.id),
            eq(brandMembers.userId, userId)
          )
        )
        .orderBy(brands.name);

  const campaignsQuery = !workspace
    ? Promise.resolve(
        [] as Array<{ id: string; name: string; brandId: string }>
      )
    : isAdmin
    ? db
        .select({
          id: campaigns.id,
          name: campaigns.name,
          brandId: campaigns.brandId,
        })
        .from(campaigns)
        .innerJoin(brands, eq(brands.id, campaigns.brandId))
        .where(eq(brands.workspaceId, workspace.id))
        .orderBy(campaigns.name)
    : db
        .select({
          id: campaigns.id,
          name: campaigns.name,
          brandId: campaigns.brandId,
        })
        .from(campaigns)
        .innerJoin(brands, eq(brands.id, campaigns.brandId))
        .innerJoin(brandMembers, eq(brandMembers.brandId, brands.id))
        .where(
          and(
            eq(brands.workspaceId, workspace.id),
            eq(brandMembers.userId, userId)
          )
        )
        .orderBy(campaigns.name);

  const [
    brandRows,
    facetCampaignRows,
    facetTagRows,
    distinctStatusRows,
  ] = await Promise.all([
    brandsQuery,
    campaignsQuery,
    // Distinct tag names across the assets the user can see (workspace-wide
    // for admins, own-only for members) so the Tag facet matches the grid.
    db
      .selectDistinct({ tag: assetTags.tag })
      .from(assetTags)
      .innerJoin(assets, eq(assets.id, assetTags.assetId))
      .where(assetScope)
      .orderBy(assetTags.tag),
    // Distinct status values — used to gate the Status section in the More
    // popover. We hide it when only one value exists so solo creators don't
    // see a useless control.
    db
      .selectDistinct({ status: assets.status })
      .from(assets)
      .where(assetScope),
  ]);

  const initialBrands = brandRows.map((b) => ({
    id: b.id,
    name: b.name,
    color: b.color,
    isPersonal: b.isPersonal,
    anchorAssetIds: (b.anchorAssetIds ?? []) as string[],
  }));

  // Personal brands literally store name="Personal", which is useless when
  // an admin sees several side by side. Surface the owner's display name
  // (falling back to email local-part, then "Personal") so they're
  // distinguishable in the dropdown.
  const facetBrands: BrandOption[] = brandRows
    .map((b) => {
      const ownerLabel =
        b.isPersonal
          ? b.ownerName?.trim() ||
            b.ownerEmail?.split("@")[0] ||
            b.name
          : b.name;
      return {
        id: b.id,
        name: ownerLabel,
        isPersonal: b.isPersonal,
        ownerImage: b.isPersonal ? b.ownerImage : null,
      };
    })
    .sort((a, b) => {
      // Pin personal brands to the top of the dropdown, alphabetised within
      // each group — matches how the sidebar groups them.
      if (a.isPersonal && !b.isPersonal) return -1;
      if (!a.isPersonal && b.isPersonal) return 1;
      return a.name.localeCompare(b.name);
    });

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
