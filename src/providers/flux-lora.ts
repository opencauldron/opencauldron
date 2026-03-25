import type { GenerationProvider, GenerationParams, GenerationResult } from "@/types";

const FAL_SYNC_BASE = "https://fal.run";

const ASPECT_TO_IMAGE_SIZE: Record<string, string> = {
  "1:1": "square_hd",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
};

function getApiKey(): string {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not set");
  return key;
}

async function generate(params: GenerationParams): Promise<GenerationResult> {
  const startTime = Date.now();

  try {
    const apiKey = getApiKey();
    const prompt = params.enhancedPrompt || params.prompt;

    const body: Record<string, unknown> = {
      prompt,
      image_size: ASPECT_TO_IMAGE_SIZE[params.aspectRatio ?? "1:1"] ?? "square_hd",
      output_format: params.outputFormat ?? "png",
      enable_safety_checker: !params.nsfwEnabled,
    };

    if (params.seed != null) body.seed = params.seed;
    if (params.guidance != null) body.guidance_scale = params.guidance;
    if (params.steps != null) body.num_inference_steps = params.steps;

    if (params.loras && params.loras.length > 0) {
      body.loras = params.loras.map((l) => ({
        path: l.path,
        scale: l.scale,
      }));
    }

    const response = await fetch(`${FAL_SYNC_BASE}/fal-ai/flux-lora`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`fal.ai Flux LoRA failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as {
      images: Array<{ url: string; width: number; height: number }>;
      seed: number;
      has_nsfw_concepts: boolean[];
    };

    const img = data.images?.[0];
    if (!img) {
      throw new Error("No image returned from fal.ai");
    }

    const imageResponse = await fetch(img.url);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download generated image (${imageResponse.status})`);
    }

    const arrayBuffer = await imageResponse.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    return {
      status: "completed",
      imageUrl: img.url,
      imageBuffer,
      width: img.width,
      height: img.height,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    };
  }
}

export const fluxLoraProvider: GenerationProvider = {
  id: "flux-dev",
  name: "Flux",
  provider: "fal",
  mediaType: "image",
  capabilities: {
    aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
    supportsNegativePrompt: false,
    supportsBatchGeneration: false,
    maxBatchSize: 1,
    supportsSeed: true,
    supportsOutputFormat: true,
    supportsGuidance: true,
    supportsSteps: true,
    supportsLora: true,
  },
  costPerImage: 0.035,
  generate,
};
