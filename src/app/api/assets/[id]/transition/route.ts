/**
 * POST /api/assets/[id]/transition
 *
 * State-machine endpoint for the agency review pipeline (US3, US4).
 * Body: { action: 'submit' | 'approve' | 'reject' | 'archive' | 'unarchive', note? }.
 *
 * Permissions are evaluated against the asset's brand context:
 *   - submit:        canSubmit          (Personal-brand assets cannot enter review)
 *   - approve:       canApprove         (brand_manager+, self-approval gated by brand flag)
 *   - reject:        canRejectOrArchive (brand_manager+)
 *   - archive:       canRejectOrArchive
 *   - unarchive:     canRejectOrArchive (admin restoration path)
 *
 * The state transition + audit row are written atomically inside transitions.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import {
  checkTransitionPermission,
  TransitionError,
  transitionAsset,
  type TransitionAction,
} from "@/lib/transitions";
import {
  loadBrandContext,
  loadRoleContext,
} from "@/lib/workspace/permissions";

const transitionSchema = z.object({
  action: z.enum(["submit", "approve", "reject", "archive", "unarchive"]),
  note: z.string().max(2000).optional(),
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
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = transitionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { action, note } = parsed.data;

  const [asset] = await db
    .select({
      id: assets.id,
      userId: assets.userId,
      brandId: assets.brandId,
      status: assets.status,
    })
    .from(assets)
    .where(eq(assets.id, id))
    .limit(1);
  if (!asset) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!asset.brandId) {
    // Agency-DAM data invariant: every asset has a brandId post-Phase-2 backfill.
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

  // Synthesize creator role on Personal brand if the membership row is missing —
  // mirrors the same carve-out in /api/generate so the user can always
  // archive/unarchive their own scratch space.
  if (
    brandCtx.isPersonal &&
    brandCtx.ownerId === userId &&
    !ctx.brandMemberships.has(brandCtx.id)
  ) {
    ctx.brandMemberships.set(brandCtx.id, "creator");
  }

  const allowed = checkTransitionPermission(
    action as TransitionAction,
    ctx,
    asset,
    brandCtx
  );
  if (!allowed.ok) {
    return NextResponse.json({ error: allowed.code }, { status: allowed.status });
  }

  try {
    const result = await transitionAsset({
      assetId: asset.id,
      actorId: userId,
      action: action as TransitionAction,
      note,
    });
    return NextResponse.json({
      ok: true,
      assetId: result.assetId,
      fromStatus: result.fromStatus,
      toStatus: result.toStatus,
    });
  } catch (err) {
    if (err instanceof TransitionError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }
}
