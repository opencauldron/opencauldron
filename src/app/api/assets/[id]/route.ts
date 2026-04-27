import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets, assetBrands, assetTags, brands, users } from "@/lib/db/schema";
import { getAssetUrl, deleteFile, refreshImageInputUrls } from "@/lib/storage";
import { canRead, loadRoleContext } from "@/lib/workspace/permissions";
import { eq } from "drizzle-orm";
import { z } from "zod";

/**
 * Approved-asset immutability guard (FR-011 / T083).
 * Surfaces a 409 with a forkUrl pointer so the client can offer "Edit / Fork".
 */
function immutableResponse(assetId: string) {
  return NextResponse.json(
    {
      error: "asset_immutable",
      forkUrl: `/api/assets/${assetId}/fork`,
    },
    { status: 409 }
  );
}

// GET /api/assets/[id] - Get a single asset with full details
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [asset] = await db
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
      createdAt: assets.createdAt,
      brandWorkspaceId: brands.workspaceId,
      brandName: brands.name,
      brandColor: brands.color,
      brandIsPersonal: brands.isPersonal,
      userName: users.name,
      userEmail: users.email,
      userImage: users.image,
    })
    .from(assets)
    .innerJoin(users, eq(users.id, assets.userId))
    .leftJoin(brands, eq(brands.id, assets.brandId))
    .where(eq(assets.id, id))
    .limit(1);

  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // FR-007: gate single-asset reads through the workspace permission helpers.
  // Workspace admins on the asset's workspace pass through; everyone else must
  // be the creator OR a member of the asset's brand. We treat orphan assets
  // (no brand resolved) as creator-only.
  if (asset.brandId && asset.brandWorkspaceId) {
    const ctx = await loadRoleContext(session.user.id, asset.brandWorkspaceId);
    if (!canRead(ctx, { brandId: asset.brandId, userId: asset.userId })) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  } else if (asset.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const assetTagRows = await db
    .select({ tag: assetTags.tag })
    .from(assetTags)
    .where(eq(assetTags.assetId, id));

  // Build URL
  const url = await getAssetUrl(asset.r2Key);
  const thumbnailUrl = asset.thumbnailR2Key
    ? await getAssetUrl(asset.thumbnailR2Key)
    : null;

  const brand = asset.brandId
    ? {
        id: asset.brandId,
        name: asset.brandName,
        color: asset.brandColor,
        isPersonal: asset.brandIsPersonal,
      }
    : null;

  // Re-sign any imageInput URLs so they don't 403 once their original presign
  // expires (R2 signed URLs are 1-hour TTL).
  const assetParams = asset.parameters as Record<string, unknown> | null;
  const refreshedParams = assetParams
    ? {
        ...assetParams,
        ...(assetParams.imageInput
          ? { imageInput: await refreshImageInputUrls(assetParams.imageInput) }
          : {}),
      }
    : assetParams;

  return NextResponse.json({
    asset: {
      id: asset.id,
      userId: asset.userId,
      brandId: asset.brandId,
      status: asset.status,
      parentAssetId: asset.parentAssetId,
      mediaType: asset.mediaType,
      model: asset.model,
      provider: asset.provider,
      prompt: asset.prompt,
      enhancedPrompt: asset.enhancedPrompt,
      parameters: refreshedParams,
      url,
      thumbnailUrl: thumbnailUrl ?? url,
      width: asset.width,
      height: asset.height,
      fileSize: asset.fileSize,
      costEstimate: asset.costEstimate,
      createdAt: asset.createdAt,
      brand,
      brands: brand ? [brand] : [],
      tags: assetTagRows.map((t) => t.tag),
      user: {
        name: asset.userName,
        email: asset.userEmail,
        image: asset.userImage,
      },
    },
  });
}

// PATCH /api/assets/[id] - Update brands/tags on an asset
const patchSchema = z.object({
  brands: z.array(z.string().uuid()).optional(),
  tags: z.array(z.string().min(1).max(100)).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Check asset exists
  const [asset] = await db
    .select({ id: assets.id, status: assets.status })
    .from(assets)
    .where(eq(assets.id, id))
    .limit(1);

  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // FR-011: approved assets are immutable; fork is the only edit path.
  if (asset.status === "approved") {
    return immutableResponse(asset.id);
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { brands: brandIds, tags } = parsed.data;

  // Update brands if provided
  if (brandIds !== undefined) {
    // Delete existing brands for this asset
    await db
      .delete(assetBrands)
      .where(eq(assetBrands.assetId, id));

    // Insert new brands
    if (brandIds.length > 0) {
      await db.insert(assetBrands).values(
        brandIds.map((brandId) => ({
          assetId: id,
          brandId,
        }))
      );
    }
  }

  // Update tags if provided
  if (tags !== undefined) {
    // Delete existing tags for this asset
    await db
      .delete(assetTags)
      .where(eq(assetTags.assetId, id));

    // Insert new tags
    if (tags.length > 0) {
      await db.insert(assetTags).values(
        tags.map((tag) => ({
          assetId: id,
          tag,
        }))
      );
    }
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/assets/[id] - Delete an asset
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [asset] = await db
    .select({
      id: assets.id,
      status: assets.status,
      r2Key: assets.r2Key,
      thumbnailR2Key: assets.thumbnailR2Key,
    })
    .from(assets)
    .where(eq(assets.id, id))
    .limit(1);

  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // FR-011: approved assets are immutable; archive instead of deleting.
  if (asset.status === "approved") {
    return immutableResponse(asset.id);
  }

  // Delete from storage
  try {
    await deleteFile(asset.r2Key);
    if (asset.thumbnailR2Key) {
      await deleteFile(asset.thumbnailR2Key);
    }
  } catch (error) {
    // Log but don't fail - asset will be orphaned in storage
    console.error("Failed to delete from storage:", error);
  }

  // Delete from DB (cascade will handle asset_brands and asset_tags)
  await db.delete(assets).where(eq(assets.id, id));

  return NextResponse.json({ success: true });
}
