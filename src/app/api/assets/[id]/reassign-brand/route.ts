/**
 * POST /api/assets/[id]/reassign-brand — move a single asset between brands.
 *
 * Permission gate (source):
 *   - asset creator (`assets.user_id = me`)
 *   - `brand_manager` on source brand
 *   - workspace `owner`/`admin`
 *
 * Permission gate (destination): caller must be `creator+` on the destination
 * (`canCreateAsset`); destination must be a non-Personal brand in the same
 * workspace and different from source.
 *
 * Hard block: approved assets cannot be moved (FR-011 immutability) — caller
 * must fork first. On success, status resets to `draft` so the destination
 * brand's reviewers can vet the asset under their own standards.
 *
 * Mutation logic lives in `@/lib/assets/mutations`; this route is the HTTP
 * adapter for the single-asset case.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import {
  AssetMutationError,
  reassignAssetBrand,
} from "@/lib/assets/mutations";
import {
  loadBrandContext,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { eq } from "drizzle-orm";
import { z } from "zod";

const bodySchema = z.object({
  brandId: z.string().uuid(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: assetId } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const targetBrandId = parsed.data.brandId;

  const [asset] = await db
    .select({
      id: assets.id,
      userId: assets.userId,
      brandId: assets.brandId,
      status: assets.status,
      prompt: assets.prompt,
      r2Key: assets.r2Key,
      thumbnailR2Key: assets.thumbnailR2Key,
      webpR2Key: assets.webpR2Key,
    })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);

  if (!asset) {
    return NextResponse.json({ error: "asset_not_found" }, { status: 404 });
  }
  if (!asset.brandId) {
    return NextResponse.json(
      { error: "source_workspace_missing" },
      { status: 500 }
    );
  }

  const sourceBrandCtx = await loadBrandContext(asset.brandId);
  if (!sourceBrandCtx) {
    return NextResponse.json(
      { error: "source_workspace_missing" },
      { status: 500 }
    );
  }

  const destBrandCtx = await loadBrandContext(targetBrandId);
  if (!destBrandCtx) {
    return NextResponse.json(
      { error: "target_brand_not_found" },
      { status: 404 }
    );
  }

  const ctx = await loadRoleContext(userId, sourceBrandCtx.workspaceId);

  try {
    const result = await reassignAssetBrand({
      asset,
      targetBrandId,
      ctx,
      sourceBrandCtx,
      destBrandCtx,
      actorId: userId,
    });
    return NextResponse.json({
      asset: {
        id: result.assetId,
        brandId: result.brandId,
        status: result.status,
      },
    });
  } catch (err) {
    if (err instanceof AssetMutationError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }
}
