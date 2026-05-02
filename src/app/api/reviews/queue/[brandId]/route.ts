/**
 * GET /api/reviews/queue/[brandId]
 *
 * Returns the in_review assets for a brand, ordered FIFO so the modal walks
 * oldest-pending-first. Permission: brand_manager+ on the brand (workspace
 * owner/admin inherits). Personal brands are not reviewable (FR-006b).
 */
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  assetCampaigns,
  assets,
  campaigns as campaignsTable,
  users,
} from "@/lib/db/schema";
import { getAssetUrl } from "@/lib/storage";
import {
  isBrandManager,
  loadBrandContext,
  loadRoleContext,
} from "@/lib/workspace/permissions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ brandId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { brandId } = await params;

  const brandCtx = await loadBrandContext(brandId);
  if (!brandCtx) {
    return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
  }
  if (brandCtx.isPersonal) {
    return NextResponse.json({ error: "personal_brand_no_review" }, { status: 403 });
  }
  const ctx = await loadRoleContext(userId, brandCtx.workspaceId);
  if (!ctx.workspace || !isBrandManager(ctx, brandCtx.id)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rows = await db
    .select({
      id: assets.id,
      userId: assets.userId,
      mediaType: assets.mediaType,
      model: assets.model,
      provider: assets.provider,
      prompt: assets.prompt,
      enhancedPrompt: assets.enhancedPrompt,
      parameters: assets.parameters,
      r2Key: assets.r2Key,
      thumbnailR2Key: assets.thumbnailR2Key,
      width: assets.width,
      height: assets.height,
      fileSize: assets.fileSize,
      duration: assets.duration,
      hasAudio: assets.hasAudio,
      brandKitOverridden: assets.brandKitOverridden,
      createdAt: assets.createdAt,
      authorName: users.name,
      authorEmail: users.email,
      authorImage: users.image,
    })
    .from(assets)
    .innerJoin(users, eq(users.id, assets.userId))
    .where(and(eq(assets.brandId, brandId), eq(assets.status, "in_review")))
    .orderBy(asc(assets.createdAt));

  // Fan-out campaign lookup so the review surfaces can show the campaign tag
  // alongside brand/model/date. Single round-trip keyed by assetId.
  const assetIds = rows.map((r) => r.id);
  const campaignRows = assetIds.length
    ? await db
        .select({
          assetId: assetCampaigns.assetId,
          campaignId: campaignsTable.id,
          campaignName: campaignsTable.name,
        })
        .from(assetCampaigns)
        .innerJoin(
          campaignsTable,
          eq(campaignsTable.id, assetCampaigns.campaignId)
        )
        .where(inArray(assetCampaigns.assetId, assetIds))
    : [];
  const campaignsByAssetId = new Map<
    string,
    { id: string; name: string }[]
  >();
  for (const r of campaignRows) {
    const list = campaignsByAssetId.get(r.assetId) ?? [];
    list.push({ id: r.campaignId, name: r.campaignName });
    campaignsByAssetId.set(r.assetId, list);
  }

  const enriched = await Promise.all(
    rows.map(async (a) => {
      const url = await getAssetUrl(a.r2Key);
      const thumbnailUrl = a.thumbnailR2Key
        ? await getAssetUrl(a.thumbnailR2Key)
        : null;
      return {
        id: a.id,
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
        duration: a.duration,
        hasAudio: a.hasAudio,
        brandKitOverridden: a.brandKitOverridden,
        campaigns: campaignsByAssetId.get(a.id) ?? [],
        createdAt: a.createdAt,
        author: {
          id: a.userId,
          name: a.authorName,
          email: a.authorEmail,
          image: a.authorImage,
        },
        // Self-approval gate hint for the client — server is still authoritative.
        canSelfApprove: brandCtx.selfApprovalAllowed || a.userId !== userId,
      };
    })
  );

  return NextResponse.json({
    brand: {
      id: brandCtx.id,
      selfApprovalAllowed: brandCtx.selfApprovalAllowed,
    },
    queue: enriched,
  });
}
