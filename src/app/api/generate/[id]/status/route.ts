import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assetCampaigns, assets, generations } from "@/lib/db/schema";
import { getProvider } from "@/providers/registry";
import { downloadAndUploadVideo } from "@/lib/storage";
import { eq, and } from "drizzle-orm";
import type { ModelId } from "@/types";
import { resolvePersonalBrandId } from "@/lib/workspace/personal";
import { loadBrandContext } from "@/lib/workspace/permissions";
import { emitActivity } from "@/lib/activity";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Get the generation record
  const [generation] = await db
    .select()
    .from(generations)
    .where(
      and(
        eq(generations.id, id),
        eq(generations.userId, session.user.id)
      )
    )
    .limit(1);

  if (!generation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // If already completed or failed, return current status
  if (generation.status === "completed") {
    // Fetch asset if exists
    let asset = null;
    if (generation.assetId) {
      const [assetRow] = await db
        .select()
        .from(assets)
        .where(eq(assets.id, generation.assetId))
        .limit(1);
      if (assetRow) {
        asset = {
          id: assetRow.id,
          url: assetRow.r2Url,
          mediaType: assetRow.mediaType,
          width: assetRow.width,
          height: assetRow.height,
          duration: assetRow.duration,
          model: assetRow.model,
          prompt: assetRow.prompt,
          costEstimate: assetRow.costEstimate,
        };
      }
    }

    return NextResponse.json({
      generationId: id,
      status: "completed",
      asset,
    });
  }

  if (generation.status === "failed") {
    return NextResponse.json({
      generationId: id,
      status: "failed",
      error: generation.errorMessage,
    });
  }

  // Still processing — poll the provider
  if (!generation.jobId) {
    return NextResponse.json({
      generationId: id,
      status: generation.status,
    });
  }

  const provider = getProvider(generation.model as ModelId);
  if (!provider?.getStatus) {
    return NextResponse.json({
      generationId: id,
      status: generation.status,
    });
  }

  // Check generation timeout (10 minutes)
  const elapsed = Date.now() - generation.createdAt.getTime();
  if (elapsed > 10 * 60 * 1000) {
    await db
      .update(generations)
      .set({
        status: "failed",
        errorMessage: "Generation timed out after 10 minutes",
        durationMs: elapsed,
      })
      .where(eq(generations.id, id));

    return NextResponse.json({
      generationId: id,
      status: "failed",
      error: "Generation timed out after 10 minutes",
    });
  }

  try {
    const result = await provider.getStatus(generation.jobId);

    if (result.status === "completed") {
      const durationMs = Date.now() - generation.createdAt.getTime();
      const videoDuration = result.duration ??
        ((generation.parameters as Record<string, unknown>)?.duration as number) ?? 5;

      // Download video and upload to R2
      let uploaded;
      if (result.videoBuffer) {
        const { uploadVideoAsset } = await import("@/lib/storage");
        uploaded = await uploadVideoAsset(result.videoBuffer, session.user.id, {
          posterUrl: result.posterUrl,
        });
      } else if (result.videoUrl) {
        uploaded = await downloadAndUploadVideo(
          result.videoUrl,
          session.user.id,
          { posterUrl: result.posterUrl }
        );
      } else {
        throw new Error("Provider returned completed but no video data");
      }

      // Create asset. Recover the brandId stashed in generation.parameters by
      // /api/generate; fall back to the user's Personal brand for legacy rows.
      const stashedBrandId =
        ((generation.parameters as Record<string, unknown>)?.brandId as string) ?? null;
      const brandId = stashedBrandId ?? (await resolvePersonalBrandId(session.user.id));
      const stashedOverride =
        ((generation.parameters as Record<string, unknown>)?.brandKitOverridden as boolean) ?? false;

      const [asset] = await db
        .insert(assets)
        .values({
          userId: session.user.id,
          brandId,
          status: "draft",
          source: "generated",
          brandKitOverridden: stashedOverride,
          mediaType: "video",
          model: generation.model,
          provider: provider.provider,
          prompt: generation.prompt,
          enhancedPrompt: generation.enhancedPrompt,
          parameters: generation.parameters,
          r2Key: uploaded.key,
          r2Url: uploaded.url,
          thumbnailR2Key: uploaded.thumbnailKey,
          fileSize: uploaded.fileSize,
          costEstimate: generation.costEstimate,
          duration: videoDuration,
          hasAudio: result.hasAudio ?? false,
        })
        .returning();

      // Update generation
      await db
        .update(generations)
        .set({
          status: "completed",
          assetId: asset.id,
          durationMs,
        })
        .where(eq(generations.id, id));

      // Pre-tag with the campaign that was selected at submit time (stashed
      // in `generation.parameters.campaignId` by /api/generate). Best-effort
      // — failures don't unwind the asset row.
      const stashedCampaignId =
        ((generation.parameters as Record<string, unknown>)?.campaignId as
          | string
          | null
          | undefined) ?? null;
      if (stashedCampaignId) {
        try {
          await db
            .insert(assetCampaigns)
            .values({ assetId: asset.id, campaignId: stashedCampaignId })
            .onConflictDoNothing();
        } catch (err) {
          console.error("[generate.status] campaign tag insert failed:", err);
        }
      }

      // Activity feed (US2 / FR-002). Two emissions: `generation.created` for
      // the new asset and `generation.completed` for the generation row.
      // Visibility is computed at the call site from the resolved brand —
      // private on Personal, brand on a managed brand.
      if (brandId) {
        const brandCtx = await loadBrandContext(brandId);
        if (brandCtx) {
          const visibility = brandCtx.isPersonal ? "private" : "brand";
          await emitActivity(db, {
            actorId: session.user.id,
            verb: "generation.created",
            objectType: "asset",
            objectId: asset.id,
            workspaceId: brandCtx.workspaceId,
            brandId,
            visibility,
            metadata: { source: "generated", mediaType: "video", model: generation.model },
          });
          await emitActivity(db, {
            actorId: session.user.id,
            verb: "generation.completed",
            objectType: "generation",
            objectId: id,
            workspaceId: brandCtx.workspaceId,
            brandId,
            visibility,
            metadata: { mediaType: "video", model: generation.model, assetId: asset.id, durationMs },
          });
        }
      }

      return NextResponse.json({
        generationId: id,
        status: "completed",
        asset: {
          id: asset.id,
          url: uploaded.url,
          mediaType: "video",
          duration: videoDuration,
          model: generation.model,
          prompt: generation.prompt,
          costEstimate: generation.costEstimate,
        },
      });
    }

    if (result.status === "failed") {
      await db
        .update(generations)
        .set({
          status: "failed",
          errorMessage: result.error ?? "Generation failed",
          durationMs: Date.now() - generation.createdAt.getTime(),
        })
        .where(eq(generations.id, id));

      return NextResponse.json({
        generationId: id,
        status: "failed",
        error: result.error,
      });
    }

    // Still processing
    return NextResponse.json({
      generationId: id,
      status: "processing",
      elapsed: Math.round(elapsed / 1000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      generationId: id,
      status: "processing",
      error: message,
    });
  }
}
