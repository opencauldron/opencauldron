import type { GenerationProvider, GenerationParams, GenerationResult, ModelId } from "@/types";
import { summarizeProviderError } from "@/lib/provider-errors";

const OPENAI_API_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_EDIT_URL = "https://api.openai.com/v1/images/edits";

// Cap how many reference images we pass to /v1/images/edits. OpenAI accepts
// multiple images for compositing; we mirror what other providers expose.
const MAX_EDIT_INPUTS = 4;

// `input_fidelity: "high"` is supported on gpt-image-1 and gpt-image-1.5 to
// preserve identity and fine details across edits. gpt-image-2 rejects the
// param ("output is already high fidelity by default") and gpt-image-1-mini
// has not been documented to support it.
const SUPPORTS_INPUT_FIDELITY: Record<string, boolean> = {
  "gpt-image-2": false,
  "gpt-image-1.5": true,
  "gpt-image-1": true,
  "gpt-image-1-mini": false,
};

async function fetchImageAsBlob(
  url: string,
): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download reference image: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") ?? "image/png";
  // OpenAI infers extension from the filename; default to .png since gpt-image
  // edits accept png/webp/jpg and our R2 assets are always one of those.
  const ext = contentType.includes("jpeg")
    ? "jpg"
    : contentType.includes("webp")
      ? "webp"
      : "png";
  return {
    blob: new Blob([arrayBuffer], { type: contentType }),
    filename: `reference.${ext}`,
  };
}

// gpt-image-* supports three sizes — square + two 2:3 portrait/landscape ratios.
const ASPECT_RATIO_TO_SIZE: Record<string, string> = {
  "1:1": "1024x1024",
  "2:3": "1024x1536",
  "3:2": "1536x1024",
};

const ASPECT_RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "2:3": { width: 1024, height: 1536 },
  "3:2": { width: 1536, height: 1024 },
};

const API_MODELS: Record<string, string> = {
  "gpt-image-2": "gpt-image-2",
  "gpt-image-1.5": "gpt-image-1.5",
  "gpt-image-1": "gpt-image-1",
  "gpt-image-1-mini": "gpt-image-1-mini",
};

// gpt-image-2 doesn't support transparent backgrounds (per OpenAI docs).
const SUPPORTS_TRANSPARENT: Record<string, boolean> = {
  "gpt-image-2": false,
  "gpt-image-1.5": true,
  "gpt-image-1": true,
  "gpt-image-1-mini": true,
};

// Per-image cost lookup for `costEstimate`. Best-effort; OpenAI bills tokens.
// Source: OpenAI public pricing for gpt-image-1 (gpt-image-1.5 matches; mini ~½).
// gpt-image-2 mirrors 1.5 pricing pending confirmed token rates.
const PRICE_TABLE: Record<string, Record<string, Record<string, number>>> = {
  "gpt-image-2": {
    "1024x1024": { low: 0.011, medium: 0.042, high: 0.167, auto: 0.042 },
    "1024x1536": { low: 0.016, medium: 0.063, high: 0.25, auto: 0.063 },
    "1536x1024": { low: 0.016, medium: 0.063, high: 0.25, auto: 0.063 },
  },
  "gpt-image-1.5": {
    "1024x1024": { low: 0.011, medium: 0.042, high: 0.167, auto: 0.042 },
    "1024x1536": { low: 0.016, medium: 0.063, high: 0.25, auto: 0.063 },
    "1536x1024": { low: 0.016, medium: 0.063, high: 0.25, auto: 0.063 },
  },
  "gpt-image-1": {
    "1024x1024": { low: 0.011, medium: 0.042, high: 0.167, auto: 0.042 },
    "1024x1536": { low: 0.016, medium: 0.063, high: 0.25, auto: 0.063 },
    "1536x1024": { low: 0.016, medium: 0.063, high: 0.25, auto: 0.063 },
  },
  "gpt-image-1-mini": {
    "1024x1024": { low: 0.005, medium: 0.021, high: 0.083, auto: 0.021 },
    "1024x1536": { low: 0.008, medium: 0.031, high: 0.125, auto: 0.031 },
    "1536x1024": { low: 0.008, medium: 0.031, high: 0.125, auto: 0.031 },
  },
};

type OpenAIImage = { b64_json?: string };
interface OpenAIApiResponse {
  data?: OpenAIImage[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { text_tokens?: number; image_tokens?: number };
  };
  error?: { message?: string; type?: string; code?: string };
}

function mapQuality(q: GenerationParams["quality"]): "low" | "medium" | "high" {
  // App-level `quality` is `"standard" | "high"`. Map to gpt-image's vocabulary.
  // OpenAI's image-gen cookbook recommends `medium` as the default for most
  // workflows; we avoid `auto` since it's non-deterministic across releases.
  if (q === "high") return "high";
  return "medium";
}

function createOpenAIGenerate(variantId: ModelId) {
  const apiModel = API_MODELS[variantId] ?? "gpt-image-1.5";

  return async function generate(params: GenerationParams): Promise<GenerationResult> {
    const startTime = Date.now();

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        status: "failed",
        error: "OPENAI_API_KEY environment variable is not set",
        durationMs: Date.now() - startTime,
      };
    }

    const aspectRatio = params.aspectRatio ?? "1:1";
    const size = ASPECT_RATIO_TO_SIZE[aspectRatio] ?? "1024x1024";
    const dimensions =
      ASPECT_RATIO_DIMENSIONS[aspectRatio] ?? ASPECT_RATIO_DIMENSIONS["1:1"];
    const quality = mapQuality(params.quality);

    // Transparency is opt-in. The PNG output_format is required for an alpha channel.
    // gpt-image-2 doesn't support transparent backgrounds, so we omit the param entirely.
    const wantsTransparent =
      (params.background === "transparent" ||
        params.transparentBackground === true) &&
      SUPPORTS_TRANSPARENT[variantId] !== false;

    const hasImage = !!params.imageInput?.length;
    const prompt = params.enhancedPrompt ?? params.prompt;

    try {
      let response: Response;

      if (hasImage) {
        // /v1/images/edits requires multipart/form-data with the actual bytes.
        // Download each reference from its R2 URL and forward as a file part.
        const form = new FormData();
        form.append("model", apiModel);
        form.append("prompt", prompt);
        form.append("n", "1");
        form.append("size", size);
        form.append("quality", quality);
        form.append("output_format", "png");
        form.append(
          "background",
          wantsTransparent ? "transparent" : "opaque",
        );
        if (SUPPORTS_INPUT_FIDELITY[variantId]) {
          // Cookbook recommends `high` for identity/detail preservation in edits.
          form.append("input_fidelity", "high");
        }

        const refs = (params.imageInput ?? []).slice(0, MAX_EDIT_INPUTS);
        for (const ref of refs) {
          const { blob, filename } = await fetchImageAsBlob(ref);
          // OpenAI accepts repeated `image[]` entries for multi-image
          // compositing. Single-image edits also accept this shape.
          form.append("image[]", blob, filename);
        }

        response = await fetch(OPENAI_EDIT_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: form,
        });
      } else {
        const body: Record<string, unknown> = {
          model: apiModel,
          prompt,
          // GenerationResult only carries one imageBuffer, so any n>1 would
          // be billed and discarded. Force n=1 until multi-image return is
          // plumbed through the system.
          n: 1,
          size,
          quality,
          output_format: "png",
          // Cookbook uses `opaque` explicitly. `auto` lets the model decide
          // and occasionally produces transparent zones we didn't request.
          background: wantsTransparent ? "transparent" : "opaque",
          // gpt-image always returns b64_json — do NOT pass `response_format`,
          // the API rejects it on this model family.
        };

        response = await fetch(OPENAI_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        return {
          status: "failed",
          error: `OpenAI API error (${response.status}): ${summarizeProviderError(errorText)}`,
          durationMs: Date.now() - startTime,
        };
      }

      const result = (await response.json()) as OpenAIApiResponse;
      const b64 = result.data?.[0]?.b64_json;
      if (!b64) {
        return {
          status: "failed",
          error: "OpenAI API returned no image data",
          durationMs: Date.now() - startTime,
        };
      }

      // Log usage for future analytics (no UI surfacing yet).
      if (result.usage) {
        console.log(
          `[openai] ${variantId} ${size} q=${quality} usage:`,
          JSON.stringify(result.usage),
        );
      }

      return {
        status: "completed",
        imageBuffer: Buffer.from(b64, "base64"),
        width: dimensions.width,
        height: dimensions.height,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: "failed",
        error: `OpenAI image generation failed: ${message}`,
        durationMs: Date.now() - startTime,
      };
    }
  };
}

export function getOpenAIPrice(
  variantId: ModelId,
  size: string,
  quality: "low" | "medium" | "high" | "auto",
): number {
  return PRICE_TABLE[variantId]?.[size]?.[quality] ?? 0;
}

const capabilities = {
  aspectRatios: ["1:1", "2:3", "3:2"],
  supportsNegativePrompt: false,
  supportsBatchGeneration: true,
  maxBatchSize: 10,
  supportsImageInput: true,
};

export const openaiGptImage2Provider: GenerationProvider = {
  id: "gpt-image-2",
  name: "OpenAI",
  provider: "openai",
  capabilities,
  mediaType: "image",
  costPerImage: 0.042,
  generate: createOpenAIGenerate("gpt-image-2"),
};

export const openaiGptImageProvider: GenerationProvider = {
  id: "gpt-image-1.5",
  name: "OpenAI",
  provider: "openai",
  capabilities,
  mediaType: "image",
  costPerImage: 0.042,
  generate: createOpenAIGenerate("gpt-image-1.5"),
};

export const openaiGptImage1Provider: GenerationProvider = {
  id: "gpt-image-1",
  name: "OpenAI",
  provider: "openai",
  capabilities,
  mediaType: "image",
  costPerImage: 0.042,
  generate: createOpenAIGenerate("gpt-image-1"),
};

export const openaiGptImageMiniProvider: GenerationProvider = {
  id: "gpt-image-1-mini",
  name: "OpenAI",
  provider: "openai",
  capabilities,
  mediaType: "image",
  costPerImage: 0.021,
  generate: createOpenAIGenerate("gpt-image-1-mini"),
};
