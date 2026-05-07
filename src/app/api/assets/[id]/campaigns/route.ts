/**
 * PATCH /api/assets/[id]/campaigns — set the asset's campaign list (M2M
 * replace). Caller must be Creator+ on the asset's brand.
 *
 * Mutation logic lives in `@/lib/assets/mutations`; this route is the HTTP
 * adapter. The bulk endpoint reuses the same helper with set/add/remove
 * modes.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import {
  AssetMutationError,
  setAssetCampaigns,
} from "@/lib/assets/mutations";
import {
  loadBrandContext,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { eq } from "drizzle-orm";
import { z } from "zod";

const bodySchema = z.object({
  campaignIds: z.array(z.string().uuid()).max(32),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: assetId } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const desired = parsed.data.campaignIds;

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

  if (!asset || !asset.brandId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const brandCtx = await loadBrandContext(asset.brandId);
  if (!brandCtx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const ctx = await loadRoleContext(session.user.id, brandCtx.workspaceId);

  try {
    const result = await setAssetCampaigns({
      asset,
      brandCtx,
      ctx,
      campaignIds: desired,
      mode: "set",
    });
    return NextResponse.json({
      success: true,
      campaignIds: result.campaignIds,
    });
  } catch (err) {
    if (err instanceof AssetMutationError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }
}
