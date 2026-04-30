/**
 * POST /api/assets/[id]/fork
 *
 * Fork an approved asset (FR-011 / FR-012). Approved assets are immutable —
 * fork is the only edit path. Result: a new draft asset that points back to
 * the source via `parentAssetId`. The fork shares the parent's r2 file (no
 * blob duplication; the parent is immutable so the file never moves), and
 * the user is redirected to /generate pre-populated to produce a fresh output.
 *
 * Permission: Creator+ on the source brand (canFork).
 * Pre-condition: source.status === 'approved' (else 409 invalid_transition).
 * Audit: writes one `asset_review_log` row with action='forked'.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { logReviewEvent } from "@/lib/transitions";
import {
  canFork,
  loadBrandContext,
  loadRoleContext,
} from "@/lib/workspace/permissions";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const [source] = await db
    .select()
    .from(assets)
    .where(eq(assets.id, id))
    .limit(1);
  if (!source) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!source.brandId) {
    return NextResponse.json({ error: "asset_missing_brand" }, { status: 409 });
  }
  if (source.status !== "approved") {
    return NextResponse.json(
      { error: "fork_requires_approved" },
      { status: 409 }
    );
  }

  const brandCtx = await loadBrandContext(source.brandId);
  if (!brandCtx) {
    return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
  }
  const ctx = await loadRoleContext(userId, brandCtx.workspaceId);
  if (!ctx.workspace) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!canFork(ctx, brandCtx)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [forked] = await db
    .insert(assets)
    .values({
      userId,
      brandId: source.brandId,
      parentAssetId: source.id,
      status: "draft",
      // Library/DAM unification (0016): the source vocabulary is now
      // uploaded | generated | imported. Forks are derivative generations,
      // so they inherit `generated`. Lineage is still captured by
      // parentAssetId; the fork API/UI continues to discriminate via that.
      source: "generated",
      brandKitOverridden: false,
      mediaType: source.mediaType,
      model: source.model,
      provider: source.provider,
      prompt: source.prompt,
      enhancedPrompt: source.enhancedPrompt,
      parameters: source.parameters,
      r2Key: source.r2Key,
      r2Url: source.r2Url,
      thumbnailR2Key: source.thumbnailR2Key,
      width: source.width,
      height: source.height,
      fileSize: source.fileSize,
      costEstimate: source.costEstimate,
      duration: source.duration,
      hasAudio: source.hasAudio,
    })
    .returning();

  await logReviewEvent({
    assetId: forked.id,
    actorId: userId,
    action: "forked",
    fromStatus: null,
    toStatus: "draft",
    note: `Forked from ${source.id}`,
  });

  return NextResponse.json({
    ok: true,
    asset: {
      id: forked.id,
      brandId: forked.brandId,
      parentAssetId: forked.parentAssetId,
      status: forked.status,
      source: forked.source,
      model: forked.model,
      prompt: forked.prompt,
      enhancedPrompt: forked.enhancedPrompt,
      parameters: forked.parameters,
      mediaType: forked.mediaType,
    },
  });
}
