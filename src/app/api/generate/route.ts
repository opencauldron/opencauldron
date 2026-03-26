import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { generations, assets, users } from "@/lib/db/schema";
import { getProvider } from "@/providers/registry";
import { fluxLoraProvider } from "@/providers/flux-lora";
import { uploadAsset } from "@/lib/storage";
import { getXPReward, awardXP, getUserXP, hasVideoAccess, checkAndAwardBadges, getLevelFromXP } from "@/lib/xp";
import { references } from "@/lib/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { ModelId } from "@/types";

const generateSchema = z.object({
  prompt: z.string().min(1).max(4000),
  enhancedPrompt: z.string().optional(),
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
  imageInput: z.string().url().optional(),
  audioEnabled: z.boolean().optional(),
  cameraControl: z.string().optional(),
  // LoRA params
  loras: z.array(z.object({
    path: z.string().url(),
    scale: z.number().min(0).max(4),
    triggerWords: z.array(z.string()).optional(),
  })).max(5).optional(),
  nsfwEnabled: z.boolean().optional(),
});

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
    prompt, enhancedPrompt, model,
    aspectRatio, style, negativePrompt, quality,
    seed, outputFormat, resolution, guidance, steps, cfgScale,
    renderingSpeed, personGeneration, watermark, promptEnhance, promptOptimizer, loop,
    duration, imageInput, audioEnabled, cameraControl,
    loras, nsfwEnabled,
  } = parsed.data;

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

  const useLoraProvider = loras && loras.length > 0 && baseProvider.provider === "bfl";
  const provider = useLoraProvider ? fluxLoraProvider : baseProvider;

  const isVideo = provider.mediaType === "video";
  const costEstimate = isVideo
    ? (provider.costPerSecond ?? 0) * (duration ?? 5)
    : provider.costPerImage;

  // Check video access via XP level
  if (isVideo) {
    const xpRecord = await getUserXP(userId);
    if (!hasVideoAccess(xpRecord.level) && user?.role !== "admin") {
      const lvl = getLevelFromXP(xpRecord.xp);
      return NextResponse.json(
        { error: `Video unlocks at Level 3 (Alchemist). You are Level ${lvl}.` },
        { status: 403 }
      );
    }
  }

  const xpReward = getXPReward(model as ModelId, isVideo ? "video" : "image", duration);

  // Create generation record
  const [generation] = await db
    .insert(generations)
    .values({
      userId,
      model,
      prompt,
      enhancedPrompt,
      parameters: {
        aspectRatio, style, negativePrompt, quality,
        seed, outputFormat, resolution, guidance, steps, cfgScale,
        renderingSpeed, personGeneration, watermark, promptEnhance, promptOptimizer, loop,
        duration, imageInput, audioEnabled, cameraControl,
        loras, nsfwEnabled,
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
        prompt: enhancedPrompt || prompt,
        model: model as ModelId,
        aspectRatio,
        duration,
        resolution,
        imageInput,
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
      if (imageInput) {
        db.update(references)
          .set({ usageCount: sql`${references.usageCount} + 1` })
          .where(eq(references.r2Url, imageInput))
          .catch(() => {});
      }

      return NextResponse.json({
        generationId: generation.id,
        status: "processing",
        mediaType: "video",
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
      prompt: enhancedPrompt || prompt,
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

    // Create asset record
    const [asset] = await db
      .insert(assets)
      .values({
        userId,
        mediaType: "image",
        model,
        provider: provider.provider,
        prompt,
        enhancedPrompt,
        parameters: {
          aspectRatio, style, negativePrompt, quality,
          seed, outputFormat, resolution, guidance, steps, cfgScale,
          renderingSpeed, personGeneration, watermark, promptEnhance,
          loras, nsfwEnabled, imageInput,
        },
        r2Key: uploaded.key,
        r2Url: uploaded.url,
        thumbnailR2Key: uploaded.thumbnailKey,
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

    // Award XP and check badges after successful generation
    const xpResult = await awardXP(userId, xpReward, "generation", `Generated ${model}`, generation.id);
    const newBadges = await checkAndAwardBadges(userId);

    // Increment reference usage count
    if (imageInput) {
      db.update(references)
        .set({ usageCount: sql`${references.usageCount} + 1` })
        .where(eq(references.r2Url, imageInput))
        .catch(() => {});
    }

    return NextResponse.json({
      generationId: generation.id,
      mediaType: "image",
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
