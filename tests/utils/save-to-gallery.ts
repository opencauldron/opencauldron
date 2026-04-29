import { getProvider } from "@/providers/registry";
import { uploadAsset } from "@/lib/storage";
import { db } from "@/lib/db";
import { assets, generations } from "@/lib/db/schema";
import { getXPReward, awardXP } from "@/lib/xp";
import { eq } from "drizzle-orm";
import type { ModelId, GenerationParams } from "@/types";

export interface GenerateAndSaveOptions {
  modelId: ModelId;
  prompt: string;
  userId: string;
  aspectRatio?: string;
  style?: string;
  renderingSpeed?: "TURBO" | "DEFAULT" | "QUALITY";
}

export interface GenerateAndSaveResult {
  assetId: string;
  generationId: string;
  url: string;
  width: number;
  height: number;
  durationMs: number;
}

export async function generateAndSave(
  opts: GenerateAndSaveOptions
): Promise<GenerateAndSaveResult> {
  const { modelId, prompt, userId, aspectRatio, style, renderingSpeed } = opts;

  const provider = getProvider(modelId);
  if (!provider) {
    throw new Error(`Provider not found or API key missing for: ${modelId}`);
  }

  const costEstimate = provider.costPerImage;
  const xpReward = getXPReward(modelId, "image");

  // Create generation record (processing)
  const [generation] = await db
    .insert(generations)
    .values({
      userId,
      model: modelId,
      prompt,
      parameters: { aspectRatio, style, renderingSpeed },
      status: "processing",
      costEstimate,
      xpEarned: xpReward,
    })
    .returning({ id: generations.id });

  // Generate image
  const startTime = Date.now();
  const params: GenerationParams = {
    prompt,
    model: modelId,
    aspectRatio,
    style,
    renderingSpeed,
  };

  const result = await provider.generate(params);
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

    throw new Error(
      `Generation failed for ${modelId}: ${result.error ?? "no image buffer"}`
    );
  }

  // Upload to R2 (image + thumbnail)
  const uploaded = await uploadAsset(result.imageBuffer, userId);

  // Resolve the user's Personal brand for the test fixture (post-agency-DAM).
  const { resolvePersonalBrandId } = await import("@/lib/workspace/personal");
  const brandId = await resolvePersonalBrandId(userId);

  // Create asset record
  const [asset] = await db
    .insert(assets)
    .values({
      userId,
      brandId,
      status: "draft",
      source: "generated",
      mediaType: "image",
      model: modelId,
      provider: provider.provider,
      prompt,
      parameters: { aspectRatio, style, renderingSpeed },
      r2Key: uploaded.key,
      r2Url: uploaded.url,
      thumbnailR2Key: uploaded.thumbnailKey,
      width: uploaded.width,
      height: uploaded.height,
      fileSize: uploaded.fileSize,
      costEstimate,
    })
    .returning();

  // Update generation as completed
  await db
    .update(generations)
    .set({
      status: "completed",
      assetId: asset.id,
      durationMs,
    })
    .where(eq(generations.id, generation.id));

  // Award XP
  await awardXP(
    userId,
    xpReward,
    "generation",
    `Generated ${modelId}`,
    generation.id
  );

  return {
    assetId: asset.id,
    generationId: generation.id,
    url: uploaded.url,
    width: uploaded.width,
    height: uploaded.height,
    durationMs,
  };
}
