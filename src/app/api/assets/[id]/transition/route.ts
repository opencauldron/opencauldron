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
 * Mutation logic lives in `@/lib/assets/mutations`; this route is the HTTP
 * adapter for the single-asset case. The bulk endpoint reuses the same
 * helper.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import {
  AssetMutationError,
  transitionAssetMutation,
} from "@/lib/assets/mutations";
import { type TransitionAction } from "@/lib/transitions";
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
      prompt: assets.prompt,
      r2Key: assets.r2Key,
      thumbnailR2Key: assets.thumbnailR2Key,
      webpR2Key: assets.webpR2Key,
    })
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

  try {
    const result = await transitionAssetMutation({
      asset,
      action: action as TransitionAction,
      ctx,
      brandCtx,
      actorId: userId,
      note,
    });

    return NextResponse.json({
      ok: true,
      assetId: result.assetId,
      fromStatus: result.fromStatus,
      toStatus: result.toStatus,
    });
  } catch (err) {
    if (err instanceof AssetMutationError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }
}
