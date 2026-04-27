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
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets, brands } from "@/lib/db/schema";
import {
  canCreateAsset,
  isBrandManager,
  isWorkspaceAdmin,
  loadBrandContext,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { logReviewEvent } from "@/lib/transitions";
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

  // Load asset + source brand in one query.
  const [row] = await db
    .select({
      assetId: assets.id,
      assetUserId: assets.userId,
      assetStatus: assets.status,
      sourceBrandId: assets.brandId,
      sourceWorkspaceId: brands.workspaceId,
      sourceIsPersonal: brands.isPersonal,
    })
    .from(assets)
    .innerJoin(brands, eq(brands.id, assets.brandId))
    .where(eq(assets.id, assetId))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "asset_not_found" }, { status: 404 });
  }
  if (row.assetStatus === "approved") {
    return NextResponse.json(
      { error: "approved_immutable_fork_required" },
      { status: 409 }
    );
  }
  if (!row.sourceWorkspaceId || !row.sourceBrandId) {
    return NextResponse.json(
      { error: "source_workspace_missing" },
      { status: 500 }
    );
  }
  if (row.sourceBrandId === targetBrandId) {
    return NextResponse.json(
      { error: "target_same_as_source" },
      { status: 400 }
    );
  }

  // Source permission gate. We need source-side role context; the destination
  // gate uses a separate context only if the destination is in another
  // workspace (which we then reject anyway), so source ctx is enough here.
  const sourceCtx = await loadRoleContext(userId, row.sourceWorkspaceId);
  const isCreatorOfAsset = row.assetUserId === userId;
  const sourceAllowed =
    isCreatorOfAsset ||
    isBrandManager(sourceCtx, row.sourceBrandId) ||
    isWorkspaceAdmin(sourceCtx);
  if (!sourceAllowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Load destination brand + check it's in the same workspace + non-Personal.
  const destCtx = await loadBrandContext(targetBrandId);
  if (!destCtx) {
    return NextResponse.json(
      { error: "target_brand_not_found" },
      { status: 404 }
    );
  }
  if (destCtx.workspaceId !== row.sourceWorkspaceId) {
    return NextResponse.json(
      { error: "cross_workspace_move_forbidden" },
      { status: 403 }
    );
  }
  if (destCtx.isPersonal) {
    return NextResponse.json(
      { error: "target_must_be_real_brand" },
      { status: 400 }
    );
  }

  // Destination permission gate — must be creator+ on destination.
  if (!canCreateAsset(sourceCtx, destCtx)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Two-step write — Neon HTTP driver lacks db.transaction. The asset update is
  // the user-facing effect; on audit-log failure we accept the audit gap rather
  // than rolling back the move.
  await db
    .update(assets)
    .set({ brandId: targetBrandId, status: "draft", updatedAt: new Date() })
    .where(eq(assets.id, assetId));

  await logReviewEvent({
    assetId,
    actorId: userId,
    action: "moved_brand",
    fromStatus: row.assetStatus as
      | "draft"
      | "in_review"
      | "approved"
      | "rejected"
      | "archived",
    toStatus: "draft",
  });

  return NextResponse.json({
    asset: {
      id: assetId,
      brandId: targetBrandId,
      status: "draft" as const,
    },
  });
}
