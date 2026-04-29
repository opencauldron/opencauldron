import type {
  GenerationProvider,
  GenerationParams,
  GenerationResult,
  ModelId,
} from "@/types";
import { summarizeProviderError } from "@/lib/provider-errors";

const ASPECT_RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1536, height: 1024 },
  "9:16": { width: 1024, height: 1536 },
  "4:3": { width: 1152, height: 864 },
  "3:4": { width: 864, height: 1152 },
  "3:2": { width: 1248, height: 832 },
  "2:3": { width: 832, height: 1248 },
  "2:1": { width: 1536, height: 768 },
  "1:2": { width: 768, height: 1536 },
};

const API_MODELS: Record<string, string> = {
  "grok-imagine": "grok-imagine-image",
  "grok-imagine-pro": "grok-imagine-image-pro",
};

function createGrokGenerate(variantId: ModelId) {
  const apiModel = API_MODELS[variantId] ?? "grok-imagine-image";

  return async function generate(params: GenerationParams): Promise<GenerationResult> {
    const startTime = Date.now();

    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return {
        status: "failed",
        error: "XAI_API_KEY environment variable is not set",
      };
    }

    const aspectRatio = params.aspectRatio ?? "1:1";
    const dimensions = ASPECT_RATIO_DIMENSIONS[aspectRatio] ?? ASPECT_RATIO_DIMENSIONS["1:1"];
    const numImages = Math.min(params.numImages ?? 1, 10);

    try {
      const response = await fetch(
        "https://api.x.ai/v1/images/generations",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: apiModel,
            prompt: params.enhancedPrompt ?? params.prompt,
            n: numImages,
            response_format: "b64_json",
            aspect_ratio: aspectRatio,
            ...(params.resolution ? { resolution: params.resolution } : {}),
          }),
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          status: "failed",
          error: `xAI API error (${response.status}): ${summarizeProviderError(errorBody)}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = (await response.json()) as {
        data: { b64_json: string }[];
      };

      if (!data.data || data.data.length === 0) {
        return {
          status: "failed",
          error: "xAI API returned no image data",
          durationMs: Date.now() - startTime,
        };
      }

      const imageBuffer = Buffer.from(data.data[0].b64_json, "base64");

      return {
        status: "completed",
        imageBuffer,
        width: dimensions.width,
        height: dimensions.height,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error";
      return {
        status: "failed",
        error: `Grok image generation failed: ${message}`,
        durationMs: Date.now() - startTime,
      };
    }
  };
}

const capabilities = {
  aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2"],
  supportsNegativePrompt: false,
  supportsBatchGeneration: true,
  maxBatchSize: 10,
  supportsResolution: true,
  resolutionOptions: ["1k", "2k"],
};

export const grokProvider: GenerationProvider = {
  id: "grok-imagine",
  name: "Grok",
  provider: "xai",
  capabilities,
  mediaType: "image",
  costPerImage: 0.02,
  generate: createGrokGenerate("grok-imagine"),
};

export async function editGrokImage(
  prompt: string,
  imageUrl: string,
  params: GenerationParams,
): Promise<GenerationResult> {
  const startTime = Date.now();
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return { status: "failed", error: "XAI_API_KEY not set" };

  const aspectRatio = params.aspectRatio ?? "1:1";
  const dimensions = ASPECT_RATIO_DIMENSIONS[aspectRatio] ?? ASPECT_RATIO_DIMENSIONS["1:1"];

  try {
    const response = await fetch("https://api.x.ai/v1/images/edits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-imagine-image",
        prompt,
        image_url: imageUrl,
        n: 1,
        response_format: "b64_json",
        aspect_ratio: aspectRatio,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { status: "failed", error: `xAI edit error (${response.status}): ${summarizeProviderError(errorBody)}`, durationMs: Date.now() - startTime };
    }

    const data = (await response.json()) as { data: { b64_json: string }[] };
    if (!data.data?.[0]) return { status: "failed", error: "No image returned", durationMs: Date.now() - startTime };

    return {
      status: "completed",
      imageBuffer: Buffer.from(data.data[0].b64_json, "base64"),
      width: dimensions.width,
      height: dimensions.height,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startTime };
  }
}

export const grokProProvider: GenerationProvider = {
  id: "grok-imagine-pro",
  name: "Grok",
  provider: "xai",
  capabilities,
  mediaType: "image",
  costPerImage: 0.07,
  generate: createGrokGenerate("grok-imagine-pro"),
};
