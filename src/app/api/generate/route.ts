import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  assetCampaigns,
  assets,
  brands,
  brandMembers,
  campaigns as campaignsTable,
  generations,
  users,
} from "@/lib/db/schema";
import { getProvider } from "@/providers/registry";
import {
  uploadAsset,
  uploadFile,
  encodeDisplayWebp,
  displayWebpKey,
} from "@/lib/storage";
import { getXPReward, awardXP, checkAndAwardBadges } from "@/lib/xp";
import { references } from "@/lib/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { ModelId } from "@/types";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import {
  canCreateAsset,
  canGenerateVideo as canGenerateVideoOnBrand,
  loadBrandContext,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { applyBrandKit, BannedTermError } from "@/lib/workspace/brand-kit";
import { bootstrapHostedSignup } from "@/lib/workspace/bootstrap";

const generateSchema = z.object({
  prompt: z.string().min(1).max(4000),
  model: z.enum([
    // Image models
    "imagen-4",
    "imagen-4-ultra",
    "imagen-4-fast",
    "imagen-flash",
    "imagen-flash-lite",
    "grok-imagine",
    "grok-imagine-pro",
    "flux-1.1-pro",
    "flux-dev",
    "flux-kontext-pro",
    "flux-2-klein",
    "ideogram-3",
    "recraft-v3",
    "recraft-20b",
    "recraft-v4",
    "recraft-v4-pro",
    "gpt-image-2",
    "gpt-image-1.5",
    "gpt-image-1",
    "gpt-image-1-mini",
    // Video models
    "veo-3",
    "veo-3.1",
    "veo-3-fast",
    "runway-gen4-turbo",
    "runway-gen4.5",
    "kling-2.1",
    "kling-2.1-pro",
    "hailuo-2.3",
    "hailuo-2.3-fast",
    "ray-2",
    "ray-flash-2",
    "wan-2.1",
  ]),
  aspectRatio: z.string().optional(),
  style: z.string().optional(),
  negativePrompt: z.string().optional(),
  quality: z.enum(["standard", "high"]).optional(),
  // Advanced params
  seed: z.number().int().optional(),
  outputFormat: z.enum(["jpeg", "png"]).optional(),
  resolution: z.string().optional(),
  guidance: z.number().optional(),
  steps: z.number().int().min(1).max(50).optional(),
  cfgScale: z.number().optional(),
  renderingSpeed: z.enum(["TURBO", "DEFAULT", "QUALITY"]).optional(),
  personGeneration: z.enum(["dont_allow", "allow_adult", "allow_all"]).optional(),
  watermark: z.boolean().optional(),
  promptEnhance: z.boolean().optional(),
  promptOptimizer: z.boolean().optional(),
  loop: z.boolean().optional(),
  // Video params
  duration: z.number().min(1).max(60).optional(),
  imageInput: z.array(z.string().url()).max(4).optional(),
  audioEnabled: z.boolean().optional(),
  cameraControl: z.string().optional(),
  // LoRA params
  loras: z.array(z.object({
    path: z.string().url(),
    scale: z.number().min(0).max(4),
    triggerWords: z.array(z.string()).optional(),
  })).max(5).optional(),
  nsfwEnabled: z.boolean().optional(),
  // Agency-DAM additions (FR-004 / FR-007 / FR-015 / FR-035).
  // brandId is optional when the user wants their Personal brand — accepted
  // either as the literal `"personal"` sentinel or omitted.
  brandId: z.union([z.string().uuid(), z.literal("personal")]).optional(),
  brandKitOverride: z.boolean().optional(),
  // Optional campaign tag — server validates that the campaign belongs to
  // the resolved brand and bulk-inserts into asset_campaigns after the asset
  // row exists. Personal brands silently ignore this field.
  campaignId: z.string().uuid().optional(),
});

/**
 * Resolve the brand for this generation:
 *   - explicit uuid → that brand (must be in the user's current workspace)
 *   - "personal" sentinel or omitted → the user's Personal brand
 * Returns 404 / 403 -shaped { error, status } object on denial.
 */
async function resolveBrand(
  userId: string,
  workspaceId: string,
  hint: string | undefined
): Promise<
  | { ok: true; brandId: string }
  | { ok: false; status: number; error: string }
> {
  if (hint && hint !== "personal") {
    const [b] = await db
      .select({ id: brands.id, workspaceId: brands.workspaceId })
      .from(brands)
      .where(eq(brands.id, hint))
      .limit(1);
    if (!b || b.workspaceId !== workspaceId) {
      return { ok: false, status: 404, error: "brand_not_found" };
    }
    return { ok: true, brandId: b.id };
  }
  const [personal] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(
      and(
        eq(brands.workspaceId, workspaceId),
        eq(brands.isPersonal, true),
        eq(brands.ownerId, userId)
      )
    )
    .limit(1);
  if (personal) return { ok: true, brandId: personal.id };
  // Lazy-create — covers users whose Personal brand was never bootstrapped.
  const result = await bootstrapHostedSignup({ userId });
  return { ok: true, brandId: result.personalBrandId };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Parse and validate input
  const body = await req.json();
  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const {
    prompt, model,
    aspectRatio, style, negativePrompt, quality,
    seed, outputFormat, resolution, guidance, steps, cfgScale,
    renderingSpeed, personGeneration, watermark, promptEnhance, promptOptimizer, loop,
    duration, imageInput, audioEnabled, cameraControl,
    loras, nsfwEnabled, brandId: brandIdHint, brandKitOverride,
    campaignId,
  } = parsed.data;

  // ---- Workspace + brand resolution (FR-004 / FR-007) -----------------
  const workspace = await getCurrentWorkspace(userId);
  if (!workspace) {
    return NextResponse.json({ error: "no_workspace" }, { status: 403 });
  }

  const resolvedBrand = await resolveBrand(userId, workspace.id, brandIdHint);
  if (!resolvedBrand.ok) {
    return NextResponse.json({ error: resolvedBrand.error }, { status: resolvedBrand.status });
  }
  const brandId = resolvedBrand.brandId;

  const brandCtx = await loadBrandContext(brandId);
  if (!brandCtx) {
    return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
  }
  const ctx = await loadRoleContext(userId, workspace.id);

  // Personal-brand carve-out: every workspace member is implicitly a creator
  // on their own Personal brand. The brand_member row exists post-bootstrap,
  // but if it's missing we synthesize the membership in-memory so the
  // permission helper passes — we don't want a missing row to lock a user
  // out of their own scratch space.
  if (brandCtx.isPersonal && brandCtx.ownerId === userId) {
    if (!ctx.brandMemberships.has(brandId)) {
      ctx.brandMemberships.set(brandId, "creator");
    }
  }

  if (!canCreateAsset(ctx, brandCtx)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Resolve the campaign tag (optional). Must belong to the same brand we
  // resolved above. Personal brands silently drop the field — we don't expose
  // campaigns there, so accepting a value would be confusing.
  let resolvedCampaignId: string | null = null;
  if (campaignId && !brandCtx.isPersonal) {
    const [c] = await db
      .select({ id: campaignsTable.id })
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.id, campaignId),
          eq(campaignsTable.brandId, brandId)
        )
      )
      .limit(1);
    if (!c) {
      return NextResponse.json(
        { error: "campaign_not_found_for_brand" },
        { status: 400 }
      );
    }
    resolvedCampaignId = c.id;
  }

  // Check rate limit
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [user] = await db
    .select({
      dailyLimit: users.dailyLimit,
      role: users.role,
      hasVideoAccess: users.hasVideoAccess,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const [{ count: todayCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(generations)
    .where(
      and(eq(generations.userId, userId), gte(generations.createdAt, today))
    );

  if (todayCount >= (user?.dailyLimit ?? 50)) {
    return NextResponse.json(
      { error: "Daily generation limit reached", limit: user?.dailyLimit },
      { status: 429 }
    );
  }

  // Get provider — swap to fal.ai LoRA endpoint when LoRAs are selected on a Flux model
  const baseProvider = getProvider(model as ModelId);
  if (!baseProvider) {
    return NextResponse.json(
      { error: `Model ${model} is not available` },
      { status: 400 }
    );
  }

  const provider = baseProvider;

  const isVideo = provider.mediaType === "video";
  const costEstimate = isVideo
    ? (provider.costPerSecond ?? 0) * (duration ?? 5)
    : provider.costPerImage;

  // ---- Video gating (FR-034 / FR-035) — admin-controlled, not XP-earned -
  if (isVideo) {
    const gate = canGenerateVideoOnBrand(ctx, brandCtx);
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.code }, { status: 403 });
    }
  }

  // ---- Brand-kit injection (FR-015 / FR-015a / FR-016) ------------------
  let kitResult;
  try {
    kitResult = await applyBrandKit({
      workspaceId: workspace.id,
      brandId,
      prompt,
      parameters: null,
      imageInput,
      loras: loras?.map((l) => l.path),
      override: !!brandKitOverride,
    });
  } catch (err) {
    if (err instanceof BannedTermError) {
      return NextResponse.json(
        { error: "banned_term", matchedTerm: err.matchedTerm },
        { status: 400 }
      );
    }
    throw err;
  }
  // The original user prompt stays as `assets.prompt` for transparency.
  // The kit-injected prompt becomes `enhancedPrompt` when the kit added
  // prefix/suffix; on override we record null so the asset shows just the
  // user's prompt verbatim.
  const promptForProvider = kitResult.brandKitOverridden
    ? prompt
    : kitResult.promptFinal;
  const enhancedPromptForRecord = kitResult.brandKitOverridden
    ? null
    : kitResult.promptFinal;
  const imageInputFinal = kitResult.imageInputFinal.length > 0
    ? kitResult.imageInputFinal
    : imageInput;

  const xpReward = getXPReward(model as ModelId, isVideo ? "video" : "image", duration);

  // Create generation record
  const [generation] = await db
    .insert(generations)
    .values({
      userId,
      model,
      prompt,
      enhancedPrompt: enhancedPromptForRecord ?? null,
      parameters: {
        aspectRatio, style, negativePrompt, quality,
        seed, outputFormat, resolution, guidance, steps, cfgScale,
        renderingSpeed, personGeneration, watermark, promptEnhance, promptOptimizer, loop,
        duration, imageInput: imageInputFinal, audioEnabled, cameraControl,
        loras, nsfwEnabled,
        brandId,
        brandKitOverridden: kitResult.brandKitOverridden,
        // Stashed so the async video-status route can pick it up after the
        // job completes (it resolves the same brand from `parameters.brandId`).
        campaignId: resolvedCampaignId,
      },
      status: "processing",
      costEstimate,
      xpEarned: xpReward,
    })
    .returning({ id: generations.id });

  // Video: submit async job and return immediately
  if (isVideo) {
    try {
      const result = await provider.generate({
        prompt: promptForProvider,
        model: model as ModelId,
        aspectRatio,
        duration,
        resolution,
        imageInput: imageInputFinal,
        audioEnabled,
        cameraControl,
        seed,
        personGeneration,
        watermark,
        promptOptimizer,
        loop,
        negativePrompt,
        loras,
        nsfwEnabled,
      });

      if (result.status === "failed") {
        await db
          .update(generations)
          .set({ status: "failed", errorMessage: result.error })
          .where(eq(generations.id, generation.id));

        return NextResponse.json(
          { error: result.error, generationId: generation.id },
          { status: 500 }
        );
      }

      // Store jobId for polling
      await db
        .update(generations)
        .set({ jobId: result.jobId })
        .where(eq(generations.id, generation.id));

      // Check for newly earned badges (async, don't block response)
      const newBadges = await checkAndAwardBadges(userId);

      // Increment reference usage count
      if (imageInputFinal && imageInputFinal.length > 0) {
        for (const url of imageInputFinal) {
          db.update(references)
            .set({ usageCount: sql`${references.usageCount} + 1` })
            .where(eq(references.r2Url, url))
            .catch(() => {});
        }
      }

      return NextResponse.json({
        generationId: generation.id,
        status: "processing",
        mediaType: "video",
        brandId,
        brandKitOverridden: kitResult.brandKitOverridden,
        xpEarned: xpReward,
        ...(user?.role === "admin" ? { costEstimate } : {}),
        ...(newBadges.length > 0 ? { newBadges } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await db
        .update(generations)
        .set({ status: "failed", errorMessage: message })
        .where(eq(generations.id, generation.id));

      return NextResponse.json(
        { error: message, generationId: generation.id },
        { status: 500 }
      );
    }
  }

  // Image: generate synchronously (existing flow)
  try {
    const startTime = Date.now();
    const result = await provider.generate({
      prompt: promptForProvider,
      model: model as ModelId,
      aspectRatio,
      style,
      negativePrompt,
      quality,
      seed,
      outputFormat,
      resolution,
      guidance,
      steps,
      cfgScale,
      renderingSpeed,
      personGeneration,
      watermark,
      promptEnhance,
      loras,
      nsfwEnabled,
      imageInput: imageInputFinal,
    });
    const durationMs = Date.now() - startTime;

    if (result.status === "failed" || !result.imageBuffer) {
      await db
        .update(generations)
        .set({
          status: "failed",
          errorMessage: result.error ?? "Generation failed",
          durationMs,
        })
        .where(eq(generations.id, generation.id));

      return NextResponse.json(
        { error: result.error ?? "Generation failed", generationId: generation.id },
        { status: 500 }
      );
    }

    // Upload to R2
    const uploaded = await uploadAsset(result.imageBuffer, userId);

    // WebP display variant (PR `feat/webp-image-delivery-backend`, T011).
    // Mirrors the upload-route logic: encode in-process, PUT to R2 at
    // `{originalKey}_display.webp`, fall through to webpStatus='failed' on
    // any error so the asset row still saves and the original is served.
    // `uploadAsset()` always writes PNGs (image/png) for now, so we can pass
    // the constant mime type.
    const generatedMimeType = "image/png";
    let genWebpR2Key: string | null = null;
    let genWebpFileSize: number | null = null;
    let genWebpStatus: "ready" | "failed" | null = null;
    let genWebpFailedReason: string | null = null;

    const encoded = await encodeDisplayWebp(
      result.imageBuffer,
      generatedMimeType
    );
    if (encoded.ok) {
      const webpKey = displayWebpKey(uploaded.key);
      try {
        await uploadFile(encoded.buffer, webpKey, "image/webp");
        genWebpR2Key = webpKey;
        genWebpFileSize = encoded.size;
        genWebpStatus = "ready";
      } catch (err) {
        genWebpStatus = "failed";
        genWebpFailedReason =
          err instanceof Error ? `r2_put: ${err.message}` : "r2_put: unknown";
        console.error(
          "[generate] WebP variant R2 PUT failed (asset still saved):",
          { key: uploaded.key, reason: genWebpFailedReason }
        );
      }
    } else {
      genWebpStatus = "failed";
      genWebpFailedReason = encoded.reason;
      console.error(
        "[generate] WebP encoder failed (asset still saved):",
        { key: uploaded.key, reason: encoded.reason }
      );
    }

    // Create asset record. brandId is set; status defaults to draft (FR-010);
    // source = generation; brandKitOverridden tracks whether the kit was
    // skipped (FR-016). Mutation guard at the DB level lives in transitions.ts.
    const [asset] = await db
      .insert(assets)
      .values({
        userId,
        brandId,
        status: "draft",
        source: "generated",
        brandKitOverridden: kitResult.brandKitOverridden,
        mediaType: "image",
        model,
        provider: provider.provider,
        prompt,
        enhancedPrompt: enhancedPromptForRecord ?? null,
        parameters: {
          aspectRatio, style, negativePrompt, quality,
          seed, outputFormat, resolution, guidance, steps, cfgScale,
          renderingSpeed, personGeneration, watermark, promptEnhance,
          loras, nsfwEnabled, imageInput: imageInputFinal,
        },
        r2Key: uploaded.key,
        r2Url: uploaded.url,
        thumbnailR2Key: uploaded.thumbnailKey,
        // WebP display variant fields (FR-005). Always set on image
        // generations; never null here because we always run the encoder.
        webpR2Key: genWebpR2Key,
        webpFileSize: genWebpFileSize,
        webpStatus: genWebpStatus,
        webpFailedReason: genWebpFailedReason,
        originalMimeType: generatedMimeType,
        width: uploaded.width,
        height: uploaded.height,
        fileSize: uploaded.fileSize,
        costEstimate,
      })
      .returning();

    // Update generation record
    await db
      .update(generations)
      .set({
        status: "completed",
        assetId: asset.id,
        durationMs,
      })
      .where(eq(generations.id, generation.id));

    // Pre-tag the new asset with the optional campaign. Best-effort — a
    // failure here doesn't unwind the asset row, the user can attach manually
    // from the Library detail panel.
    if (resolvedCampaignId) {
      try {
        await db
          .insert(assetCampaigns)
          .values({ assetId: asset.id, campaignId: resolvedCampaignId })
          .onConflictDoNothing();
      } catch (err) {
        console.error("[generate] campaign tag insert failed:", err);
      }
    }

    // Award XP and check badges after successful generation
    const xpResult = await awardXP(userId, xpReward, "generation", `Generated ${model}`, generation.id);
    const newBadges = await checkAndAwardBadges(userId);

    // Increment reference usage count
    if (imageInputFinal && imageInputFinal.length > 0) {
      for (const url of imageInputFinal) {
        db.update(references)
          .set({ usageCount: sql`${references.usageCount} + 1` })
          .where(eq(references.r2Url, url))
          .catch(() => {});
      }
    }

    return NextResponse.json({
      generationId: generation.id,
      mediaType: "image",
      brandId,
      brandKitOverridden: kitResult.brandKitOverridden,
      status: "draft",
      xpEarned: xpReward,
      leveledUp: xpResult.leveledUp ? xpResult.newLevel : undefined,
      asset: {
        id: asset.id,
        url: uploaded.url,
        width: uploaded.width,
        height: uploaded.height,
        model,
        prompt,
        ...(user?.role === "admin" ? { costEstimate } : {}),
      },
      ...(newBadges.length > 0 ? { newBadges } : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    await db
      .update(generations)
      .set({
        status: "failed",
        errorMessage: message,
      })
      .where(eq(generations.id, generation.id));

    return NextResponse.json(
      { error: message, generationId: generation.id },
      { status: 500 }
    );
  }
}
