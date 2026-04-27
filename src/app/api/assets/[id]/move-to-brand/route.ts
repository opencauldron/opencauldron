/**
 * POST /api/assets/[id]/move-to-brand — Personal → real-brand promotion (T149a / FR-006c).
 *
 * Source asset MUST live on a Personal brand owned by the caller. Destination
 * MUST be a non-Personal brand in the same workspace where the caller has
 * Creator+. Promotion is in-place: same `assets.id`, `brandId` updates,
 * `status` resets to `draft`, audit row written with `action='moved_from_personal'`.
 * No R2 file duplication, no fork (per OQ-005 resolution).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets, brands } from "@/lib/db/schema";
import {
  canCreateAsset,
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
      sourceOwnerId: brands.ownerId,
    })
    .from(assets)
    .innerJoin(brands, eq(brands.id, assets.brandId))
    .where(eq(assets.id, assetId))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "asset_not_found" }, { status: 404 });
  }
  if (row.assetUserId !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!row.sourceIsPersonal) {
    return NextResponse.json(
      { error: "source_not_personal" },
      { status: 409 }
    );
  }
  if (row.sourceOwnerId !== userId) {
    // Defensive — Personal brand owner mismatch shouldn't be reachable.
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!row.sourceWorkspaceId) {
    return NextResponse.json({ error: "source_workspace_missing" }, { status: 500 });
  }

  // Load destination brand + check it's in the same workspace + non-Personal.
  const destCtx = await loadBrandContext(targetBrandId);
  if (!destCtx) {
    return NextResponse.json({ error: "target_brand_not_found" }, { status: 404 });
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

  // Permission gate on destination.
  const ctx = await loadRoleContext(userId, destCtx.workspaceId);
  if (!canCreateAsset(ctx, destCtx)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Two-step: update assets, then write audit row. Neon HTTP driver doesn't
  // support db.transaction, so on log failure we leave the audit gap rather
  // than rolling back the move (the move itself is the user-facing effect).
  await db
    .update(assets)
    .set({ brandId: targetBrandId, status: "draft", updatedAt: new Date() })
    .where(eq(assets.id, assetId));

  await logReviewEvent({
    assetId,
    actorId: userId,
    action: "moved_from_personal",
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
