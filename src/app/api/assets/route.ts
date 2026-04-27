import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets, assetBrands, assetTags, brands, users } from "@/lib/db/schema";
import { getAssetUrl } from "@/lib/storage";
import { eq, desc, and, ilike, inArray, lt } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const brand = searchParams.get("brand");
  const model = searchParams.get("model");
  const mediaType = searchParams.get("mediaType");
  const tag = searchParams.get("tag");
  const creator = searchParams.get("creator");
  const search = searchParams.get("search");
  const cursor = searchParams.get("cursor");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "30", 10), 100);

  // Build where conditions
  const conditions = [];

  if (mediaType && (mediaType === "image" || mediaType === "video")) {
    conditions.push(eq(assets.mediaType, mediaType));
  }

  if (model) {
    conditions.push(eq(assets.model, model));
  }

  if (creator) {
    conditions.push(eq(assets.userId, creator));
  }

  if (search) {
    conditions.push(ilike(assets.prompt, `%${search}%`));
  }

  if (cursor) {
    conditions.push(lt(assets.createdAt, new Date(cursor)));
  }

  // If filtering by brand, get asset IDs that have the brand
  if (brand) {
    const brandAssetIds = await db
      .select({ assetId: assetBrands.assetId })
      .from(assetBrands)
      .innerJoin(brands, eq(brands.id, assetBrands.brandId))
      .where(eq(brands.id, brand));

    const ids = brandAssetIds.map((r) => r.assetId);
    if (ids.length === 0) {
      return NextResponse.json({ assets: [], nextCursor: null });
    }
    conditions.push(inArray(assets.id, ids));
  }

  // If filtering by tag, get asset IDs with that tag
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

  // Fetch assets
  const where = conditions.length > 0 ? and(...conditions) : undefined;

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
      userName: users.name,
      userEmail: users.email,
      userImage: users.image,
    })
    .from(assets)
    .innerJoin(users, eq(users.id, assets.userId))
    .where(where)
    .orderBy(desc(assets.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const assetRows = hasMore ? rows.slice(0, limit) : rows;

  if (assetRows.length === 0) {
    return NextResponse.json({ assets: [], nextCursor: null });
  }

  const assetIds = assetRows.map((a) => a.id);

  // Fetch brands and tags for these assets
  const [brandRows, tagRows] = await Promise.all([
    db
      .select({
        assetId: assetBrands.assetId,
        brandId: brands.id,
        brandName: brands.name,
        brandColor: brands.color,
      })
      .from(assetBrands)
      .innerJoin(brands, eq(brands.id, assetBrands.brandId))
      .where(inArray(assetBrands.assetId, assetIds)),
    db
      .select({
        assetId: assetTags.assetId,
        tag: assetTags.tag,
      })
      .from(assetTags)
      .where(inArray(assetTags.assetId, assetIds)),
  ]);

  // Group brands and tags by asset
  const brandsByAsset = new Map<string, { id: string; name: string; color: string }[]>();
  for (const row of brandRows) {
    const arr = brandsByAsset.get(row.assetId) ?? [];
    arr.push({ id: row.brandId, name: row.brandName, color: row.brandColor });
    brandsByAsset.set(row.assetId, arr);
  }

  const tagsByAsset = new Map<string, string[]>();
  for (const row of tagRows) {
    const arr = tagsByAsset.get(row.assetId) ?? [];
    arr.push(row.tag);
    tagsByAsset.set(row.assetId, arr);
  }

  // Build URLs
  const assetResults = await Promise.all(
    assetRows.map(async (a) => {
      const url = await getAssetUrl(a.r2Key);
      const thumbnailUrl = a.thumbnailR2Key
        ? await getAssetUrl(a.thumbnailR2Key)
        : null;

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
        parameters: a.parameters,
        url,
        thumbnailUrl: thumbnailUrl ?? url,
        width: a.width,
        height: a.height,
        fileSize: a.fileSize,
        costEstimate: a.costEstimate,
        duration: a.duration,
        hasAudio: a.hasAudio,
        createdAt: a.createdAt,
        brands: brandsByAsset.get(a.id) ?? [],
        tags: tagsByAsset.get(a.id) ?? [],
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
