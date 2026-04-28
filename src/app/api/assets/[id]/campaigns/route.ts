/**
 * PATCH /api/assets/[id]/campaigns — set the asset's campaign list (M2M
 * replace). Caller must be Creator+ on the asset's brand.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assetCampaigns, assets, campaigns } from "@/lib/db/schema";
import {
  canCreateAsset,
  loadBrandContext,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { and, eq, inArray } from "drizzle-orm";
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
    .select({ id: assets.id, brandId: assets.brandId })
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
  if (!canCreateAsset(ctx, brandCtx)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // All campaign ids must belong to the asset's brand. Catches typos and
  // cross-brand leakage.
  if (desired.length > 0) {
    const valid = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(
        and(eq(campaigns.brandId, asset.brandId), inArray(campaigns.id, desired))
      );
    if (valid.length !== desired.length) {
      return NextResponse.json(
        { error: "campaigns_not_in_brand" },
        { status: 400 }
      );
    }
  }

  await db.delete(assetCampaigns).where(eq(assetCampaigns.assetId, assetId));
  if (desired.length > 0) {
    await db
      .insert(assetCampaigns)
      .values(desired.map((cid) => ({ assetId, campaignId: cid })));
  }

  return NextResponse.json({ success: true, campaignIds: desired });
}
