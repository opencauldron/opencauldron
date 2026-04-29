import type { GenerationProvider, GenerationParams, GenerationResult, ModelId } from "@/types";

const FAL_SYNC_BASE = "https://fal.run";

const ASPECT_TO_IMAGE_SIZE: Record<string, string> = {
  "1:1": "square_hd",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
};

/**
 * Resolve the correct fal.ai endpoint based on model, LoRAs, and image input.
 *
 * Each model has a base t2i endpoint but may need a different endpoint
 * when LoRAs or reference images are involved.
 */
function resolveEndpoint(modelId: ModelId, params: GenerationParams): string {
  const hasLoras = params.loras && params.loras.length > 0;
  const hasImage = params.imageInput && params.imageInput.length > 0;

  switch (modelId) {
    case "flux-2-klein":
      // Klein uses the edit/lora endpoint when images or LoRAs are present
      if (hasImage || hasLoras) return "fal-ai/flux-2/klein/9b/edit/lora";
      return "fal-ai/flux-2-klein/9b";

    case "flux-kontext-pro":
      if (hasLoras) return "fal-ai/flux-kontext-lora";
      return "fal-ai/flux-pro/kontext/text-to-image";

    case "flux-dev":
      if (hasImage && hasLoras) return "fal-ai/flux-lora/image-to-image";
      if (hasImage) return "fal-ai/flux-lora/image-to-image";
      if (hasLoras) return "fal-ai/flux-lora";
      return "fal-ai/flux/dev";

    case "flux-1.1-pro":
    default:
      // Pro doesn't have native LoRA/i2i — fall back to Dev LoRA endpoints
      if (hasImage && hasLoras) return "fal-ai/flux-lora/image-to-image";
      if (hasImage) return "fal-ai/flux-lora/image-to-image";
      if (hasLoras) return "fal-ai/flux-lora";
      return "fal-ai/flux-pro/v1.1";
  }
}

function getApiKey(): string {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not set");
  return key;
}

function createFluxGenerate(modelId: ModelId) {
  return async function generate(params: GenerationParams): Promise<GenerationResult> {
    const startTime = Date.now();

    try {
      const apiKey = getApiKey();
      const prompt = params.enhancedPrompt || params.prompt;
      const endpoint = resolveEndpoint(modelId, params);
      const isKleinEdit = endpoint.includes("klein") && endpoint.includes("edit");
      const isKontext = endpoint.includes("kontext");

      const body: Record<string, unknown> = {
        prompt,
        output_format: params.outputFormat ?? "png",
        enable_safety_checker: !params.nsfwEnabled,
      };

      // Kontext uses aspect_ratio string; others use image_size enum
      if (isKontext) {
        body.aspect_ratio = params.aspectRatio ?? "1:1";
      } else {
        body.image_size = ASPECT_TO_IMAGE_SIZE[params.aspectRatio ?? "1:1"] ?? "square_hd";
      }

      if (params.seed != null) body.seed = params.seed;

      // Dev/LoRA-specific params
      if (params.guidance != null) body.guidance_scale = params.guidance;
      if (params.steps != null) body.num_inference_steps = params.steps;
      if (params.promptEnhance != null) body.enhance_prompt = params.promptEnhance;

      // LoRAs
      if (params.loras && params.loras.length > 0) {
        const maxLoras = isKleinEdit ? 3 : 5;
        body.loras = params.loras.slice(0, maxLoras).map((l) => ({
          path: l.path,
          scale: l.scale,
        }));
      }

      // Reference images
      if (params.imageInput && params.imageInput.length > 0) {
        if (isKleinEdit) {
          // Klein edit accepts multiple images
          body.image_urls = params.imageInput;
        } else {
          // Other i2i endpoints accept a single image
          body.image_url = params.imageInput[0];
          body.strength = 0.85;
        }
      }

      const response = await fetch(`${FAL_SYNC_BASE}/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Key ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `fal.ai Flux failed (${response.status}): ${summarizeFalError(text)}`
        );
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
  };
}

/**
 * fal.ai 4xx responses commonly echo back the full request `input` (signed
 * URLs, the user's prompt, the entire request body) in their JSON error
 * payload. Surfacing that verbatim in a toast leaks signed asset URLs and
 * hides the actual cause behind a wall of text. Pull out just the human-
 * meaningful message; if we can't parse it, truncate so the toast stays
 * readable.
 */
function summarizeFalError(raw: string): string {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const msg = extractMessage(parsed);
    if (msg) return msg.length > 240 ? msg.slice(0, 239) + "…" : msg;
  } catch {
    // Not JSON — fall through to plain-text truncation.
  }
  return trimmed.length > 240 ? trimmed.slice(0, 239) + "…" : trimmed;
}

function extractMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  // Common shapes: { detail: "..." } | { detail: [{ msg, loc }] } |
  // { message: "..." } | { error: "..." }
  if (typeof obj.detail === "string") return obj.detail;
  if (Array.isArray(obj.detail) && obj.detail.length > 0) {
    const parts = obj.detail
      .map((d) => {
        if (!d || typeof d !== "object") return null;
        const item = d as Record<string, unknown>;
        const msg = typeof item.msg === "string" ? item.msg : null;
        const loc = Array.isArray(item.loc)
          ? item.loc.filter((l) => typeof l === "string" || typeof l === "number").join(".")
          : null;
        if (msg && loc) return `${loc}: ${msg}`;
        return msg;
      })
      .filter((s): s is string => Boolean(s));
    if (parts.length > 0) return parts.join("; ");
  }
  if (typeof obj.message === "string") return obj.message;
  if (typeof obj.error === "string") return obj.error;
  return null;
}

const baseCapabilities = {
  aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
  supportsNegativePrompt: false,
  supportsBatchGeneration: false,
  maxBatchSize: 1,
  supportsSeed: true,
  supportsOutputFormat: true,
  supportsLora: true,
  supportsImageInput: true,
};

export const fluxProvider: GenerationProvider = {
  id: "flux-1.1-pro",
  name: "Flux",
  provider: "fal",
  capabilities: {
    ...baseCapabilities,
    supportsPromptEnhance: true,
  },
  mediaType: "image",
  costPerImage: 0.04,
  generate: createFluxGenerate("flux-1.1-pro"),
};

export const fluxDevProvider: GenerationProvider = {
  id: "flux-dev",
  name: "Flux",
  provider: "fal",
  capabilities: {
    ...baseCapabilities,
    supportsSteps: true,
    supportsGuidance: true,
  },
  mediaType: "image",
  costPerImage: 0.025,
  generate: createFluxGenerate("flux-dev"),
};

export const fluxKontextProvider: GenerationProvider = {
  id: "flux-kontext-pro",
  name: "Flux",
  provider: "fal",
  capabilities: {
    ...baseCapabilities,
    supportsGuidance: true,
    supportsPromptEnhance: true,
  },
  mediaType: "image",
  costPerImage: 0.04,
  generate: createFluxGenerate("flux-kontext-pro"),
};

export const fluxKleinProvider: GenerationProvider = {
  id: "flux-2-klein",
  name: "Flux",
  provider: "fal",
  capabilities: baseCapabilities,
  mediaType: "image",
  costPerImage: 0.011,
  generate: createFluxGenerate("flux-2-klein"),
};
