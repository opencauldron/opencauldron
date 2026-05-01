import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  assets,
  assetCampaigns,
  assetTags,
  brands,
  users,
} from "@/lib/db/schema";
import { getAssetUrl, refreshImageInputUrls } from "@/lib/storage";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import {
  isWorkspaceAdmin,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { and, desc, eq, ilike, inArray, lt, or } from "drizzle-orm";

const ASSET_STATUSES = [
  "draft",
  "in_review",
  "approved",
  "rejected",
  "archived",
] as const;
type AssetStatus = (typeof ASSET_STATUSES)[number];

function isStatus(v: string | null): v is AssetStatus {
  return v !== null && (ASSET_STATUSES as readonly string[]).includes(v);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const workspace = await getCurrentWorkspace(userId);
  if (!workspace) {
    return NextResponse.json({ assets: [], nextCursor: null });
  }

  const ctx = await loadRoleContext(userId, workspace.id);

  const { searchParams } = new URL(req.url);
  const brand = searchParams.get("brand");
  const model = searchParams.get("model");
  const mediaType = searchParams.get("mediaType");
  const tag = searchParams.get("tag");
  const creator = searchParams.get("creator");
  const search = searchParams.get("search");
  const statusParam = searchParams.get("status");
  const campaign = searchParams.get("campaign");
  const cursor = searchParams.get("cursor");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "30", 10), 100);

  const conditions = [eq(brands.workspaceId, workspace.id)];

  // Read permission gate (FR-007). Workspace admin/owner sees everything in
  // the workspace; everyone else sees only assets they created OR assets on a
  // brand they're a member of.
  if (!isWorkspaceAdmin(ctx)) {
    const memberBrandIds = Array.from(ctx.brandMemberships.keys());
    if (memberBrandIds.length === 0) {
      conditions.push(eq(assets.userId, userId));
    } else {
      conditions.push(
        or(eq(assets.userId, userId), inArray(assets.brandId, memberBrandIds))!
      );
    }
  }

  if (mediaType === "image" || mediaType === "video") {
    conditions.push(eq(assets.mediaType, mediaType));
  }
  if (model) conditions.push(eq(assets.model, model));
  if (creator) conditions.push(eq(assets.userId, creator));
  if (search) conditions.push(ilike(assets.prompt, `%${search}%`));
  if (cursor) conditions.push(lt(assets.createdAt, new Date(cursor)));
  if (isStatus(statusParam)) conditions.push(eq(assets.status, statusParam));
  if (brand) conditions.push(eq(assets.brandId, brand));

  if (tag) {
    const tagAssetIds = await db
      .select({ assetId: assetTags.assetId })
      .from(assetTags)
      .where(eq(assetTags.tag, tag));
    const ids = tagAssetIds.map((r) => r.assetId);
    if (ids.length === 0) {
      return NextResponse.json({ assets: [], nextCursor: null });
    }
    conditions.push(inArray(assets.id, ids));
  }

  if (campaign) {
    const campaignAssetIds = await db
      .select({ assetId: assetCampaigns.assetId })
      .from(assetCampaigns)
      .where(eq(assetCampaigns.campaignId, campaign));
    const ids = campaignAssetIds.map((r) => r.assetId);
    if (ids.length === 0) {
      return NextResponse.json({ assets: [], nextCursor: null });
    }
    conditions.push(inArray(assets.id, ids));
  }

  const where = and(...conditions);

  const rows = await db
    .select({
      id: assets.id,
      userId: assets.userId,
      brandId: assets.brandId,
      status: assets.status,
      parentAssetId: assets.parentAssetId,
      mediaType: assets.mediaType,
      model: assets.model,
      provider: assets.provider,
      prompt: assets.prompt,
      enhancedPrompt: assets.enhancedPrompt,
      parameters: assets.parameters,
      r2Key: assets.r2Key,
      r2Url: assets.r2Url,
      thumbnailR2Key: assets.thumbnailR2Key,
      width: assets.width,
      height: assets.height,
      fileSize: assets.fileSize,
      costEstimate: assets.costEstimate,
      duration: assets.duration,
      hasAudio: assets.hasAudio,
      createdAt: assets.createdAt,
      // PR `feat/webp-image-delivery-backend` additions — Gallery hydration
      // mirrors Library so the shared download component reads the same
      // shape from both surfaces.
      webpR2Key: assets.webpR2Key,
      webpFileSize: assets.webpFileSize,
      webpStatus: assets.webpStatus,
      originalMimeType: assets.originalMimeType,
      brandName: brands.name,
      brandColor: brands.color,
      brandIsPersonal: brands.isPersonal,
      userName: users.name,
      userEmail: users.email,
      userImage: users.image,
    })
    .from(assets)
    .innerJoin(users, eq(users.id, assets.userId))
    .innerJoin(brands, eq(brands.id, assets.brandId))
    .where(where)
    .orderBy(desc(assets.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const assetRows = hasMore ? rows.slice(0, limit) : rows;

  if (assetRows.length === 0) {
    return NextResponse.json({ assets: [], nextCursor: null });
  }

  const assetIds = assetRows.map((a) => a.id);

  const [tagRows, campaignRows] = await Promise.all([
    db
      .select({ assetId: assetTags.assetId, tag: assetTags.tag })
      .from(assetTags)
      .where(inArray(assetTags.assetId, assetIds)),
    db
      .select({
        assetId: assetCampaigns.assetId,
        campaignId: assetCampaigns.campaignId,
      })
      .from(assetCampaigns)
      .where(inArray(assetCampaigns.assetId, assetIds)),
  ]);

  const tagsByAsset = new Map<string, string[]>();
  for (const row of tagRows) {
    const arr = tagsByAsset.get(row.assetId) ?? [];
    arr.push(row.tag);
    tagsByAsset.set(row.assetId, arr);
  }

  const campaignsByAsset = new Map<string, string[]>();
  for (const row of campaignRows) {
    const arr = campaignsByAsset.get(row.assetId) ?? [];
    arr.push(row.campaignId);
    campaignsByAsset.set(row.assetId, arr);
  }

  const assetResults = await Promise.all(
    assetRows.map(async (a) => {
      // Resolve url, thumbnail, and webp variant URLs in parallel — saves a
      // round-trip per asset when the row has all three keys (typical post-
      // backfill).
      const [url, thumbnailUrl, webpUrl] = await Promise.all([
        getAssetUrl(a.r2Key),
        a.thumbnailR2Key ? getAssetUrl(a.thumbnailR2Key) : Promise.resolve(null),
        a.webpR2Key ? getAssetUrl(a.webpR2Key) : Promise.resolve(null),
      ]);

      const brand = a.brandId
        ? {
            id: a.brandId,
            name: a.brandName,
            color: a.brandColor,
            isPersonal: a.brandIsPersonal,
          }
        : null;

      // Re-sign any imageInput URLs captured at generation time so they don't
      // 403 once their original presign expires.
      const params = a.parameters as Record<string, unknown> | null;
      const refreshedParams = params
        ? {
            ...params,
            ...(params.imageInput
              ? { imageInput: await refreshImageInputUrls(params.imageInput) }
              : {}),
          }
        : params;

      return {
        id: a.id,
        userId: a.userId,
        brandId: a.brandId,
        status: a.status,
        parentAssetId: a.parentAssetId,
        mediaType: a.mediaType,
        model: a.model,
        provider: a.provider,
        prompt: a.prompt,
        enhancedPrompt: a.enhancedPrompt,
        parameters: refreshedParams,
        url,
        thumbnailUrl: thumbnailUrl ?? url,
        width: a.width,
        height: a.height,
        fileSize: a.fileSize,
        costEstimate: a.costEstimate,
        duration: a.duration,
        hasAudio: a.hasAudio,
        createdAt: a.createdAt,
        // PR `feat/webp-image-delivery-backend` — surface for PR 2 frontend.
        // `originalFileSize` is the same value as `fileSize`, named explicitly
        // so the dual-format download menu reads symmetrically with
        // `webpFileSize`. `webpStatus` controls the silent-fallback decision.
        webpUrl,
        webpFileSize: a.webpFileSize,
        webpStatus: a.webpStatus,
        originalMimeType: a.originalMimeType,
        originalFileSize: a.fileSize,
        brand,
        // Legacy multi-brand shape; until 0010 ships every asset still has one
        // single canonical brand. Kept so older clients keep rendering.
        brands: brand ? [brand] : [],
        tags: tagsByAsset.get(a.id) ?? [],
        campaignIds: campaignsByAsset.get(a.id) ?? [],
        user: {
          name: a.userName,
          email: a.userEmail,
          image: a.userImage,
        },
      };
    })
  );

  const nextCursor = hasMore
    ? assetRows[assetRows.length - 1].createdAt.toISOString()
    : null;

  return NextResponse.json({ assets: assetResults, nextCursor });
}
