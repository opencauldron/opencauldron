/**
 * GET /api/assets/[id]/history
 *
 * Returns the asset's review-log timeline. Visible to:
 *   - workspace owner/admin on the asset's brand workspace
 *   - any brand_manager+ on the asset's brand
 *   - the asset's creator (their own audit trail)
 */
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assetReviewLog, assets, users } from "@/lib/db/schema";
import {
  isBrandManager,
  isWorkspaceAdmin,
  loadBrandContext,
  loadRoleContext,
} from "@/lib/workspace/permissions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const [asset] = await db
    .select({ id: assets.id, userId: assets.userId, brandId: assets.brandId })
    .from(assets)
    .where(eq(assets.id, id))
    .limit(1);
  if (!asset) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!asset.brandId) {
    return NextResponse.json({ error: "asset_missing_brand" }, { status: 409 });
  }

  const brandCtx = await loadBrandContext(asset.brandId);
  if (!brandCtx) {
    return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
  }
  const ctx = await loadRoleContext(userId, brandCtx.workspaceId);
  if (!ctx.workspace) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const isCreator = asset.userId === userId;
  if (!isCreator && !isWorkspaceAdmin(ctx) && !isBrandManager(ctx, brandCtx.id)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rows = await db
    .select({
      id: assetReviewLog.id,
      action: assetReviewLog.action,
      fromStatus: assetReviewLog.fromStatus,
      toStatus: assetReviewLog.toStatus,
      note: assetReviewLog.note,
      createdAt: assetReviewLog.createdAt,
      actorId: assetReviewLog.actorId,
      actorName: users.name,
      actorEmail: users.email,
      actorImage: users.image,
    })
    .from(assetReviewLog)
    .innerJoin(users, eq(users.id, assetReviewLog.actorId))
    .where(eq(assetReviewLog.assetId, id))
    .orderBy(desc(assetReviewLog.createdAt));

  return NextResponse.json({
    history: rows.map((r) => ({
      id: r.id,
      action: r.action,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      note: r.note,
      createdAt: r.createdAt,
      actor: {
        id: r.actorId,
        name: r.actorName,
        email: r.actorEmail,
        image: r.actorImage,
      },
    })),
  });
}
