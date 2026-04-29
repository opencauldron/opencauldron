import type {
  GenerationProvider,
  GenerationParams,
  GenerationResult,
  ModelCapabilities,
  ModelId,
} from "@/types";
import { summarizeProviderError } from "@/lib/provider-errors";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

const SUPPORTED_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"];

const capabilities: ModelCapabilities = {
  aspectRatios: SUPPORTED_ASPECT_RATIOS,
  supportsNegativePrompt: true,
  supportsBatchGeneration: true,
  maxBatchSize: 4,
  supportsSeed: true,
  supportsResolution: true,
  resolutionOptions: ["1K", "2K"],
  supportsPersonGeneration: true,
  supportsWatermarkToggle: true,
  supportsPromptEnhance: true,
  supportsOutputFormat: true,
};

const flashCapabilities: ModelCapabilities = {
  aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "2:3", "3:2", "4:5", "5:4", "21:9"],
  supportsNegativePrompt: true,
  supportsBatchGeneration: false,
  maxBatchSize: 1,
  supportsSeed: true,
  supportsResolution: true,
  resolutionOptions: ["512", "1K", "2K", "4K"],
  supportsPersonGeneration: true,
  supportsWatermarkToggle: true,
  supportsPromptEnhance: true,
  supportsOutputFormat: true,
};

// ---------------------------------------------------------------------------
// Variant definitions
// ---------------------------------------------------------------------------

interface ImagenVariant {
  apiModel: string;
  /** "predict" for Imagen 4, "generateContent" for Gemini Flash models */
  apiStyle: "predict" | "generateContent";
}

const VARIANTS: Record<string, ImagenVariant> = {
  "imagen-4": {
    apiModel: "imagen-4.0-generate-001",
    apiStyle: "predict",
  },
  "imagen-flash": {
    apiModel: "gemini-3.1-flash-image-preview",
    apiStyle: "generateContent",
  },
  "imagen-flash-lite": {
    apiModel: "gemini-2.5-flash-image",
    apiStyle: "generateContent",
  },
  "imagen-4-ultra": {
    apiModel: "imagen-4.0-ultra-generate-001",
    apiStyle: "predict",
  },
  "imagen-4-fast": {
    apiModel: "imagen-4.0-fast-generate-001",
    apiStyle: "predict",
  },
};

// ---------------------------------------------------------------------------
// Imagen 4 predict API
// ---------------------------------------------------------------------------

async function callPredictAPI(
  apiModel: string,
  prompt: string,
  aspectRatio: string,
  numImages: number,
  params: GenerationParams,
): Promise<{ imageBytes: string }[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY environment variable is not set");

  const url = `${GEMINI_API_BASE}/models/${apiModel}:predict?key=${apiKey}`;

  const parameters: Record<string, unknown> = {
    sampleCount: numImages,
    aspectRatio,
    personGeneration: params.personGeneration ?? "allow_adult",
  };

  if (params.negativePrompt) parameters.negativePrompt = params.negativePrompt;
  if (params.seed !== undefined) parameters.seed = params.seed;
  if (params.resolution) parameters.imageSize = params.resolution;
  if (params.promptEnhance !== undefined) parameters.enhancePrompt = params.promptEnhance;

  if (params.outputFormat) {
    const mimeMap: Record<string, string> = {
      jpeg: "image/jpeg",
      png: "image/png",
    };
    parameters.outputOptions = { mimeType: mimeMap[params.outputFormat] ?? "image/png" };
  }

  const body = {
    instances: [{ prompt }],
    parameters,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Imagen API request failed (${response.status}): ${summarizeProviderError(errorBody)}`);
  }

  const data = (await response.json()) as {
    predictions?: { bytesBase64Encoded: string; mimeType: string }[];
  };

  if (!data.predictions || data.predictions.length === 0) {
    throw new Error("Imagen API returned no images");
  }

  return data.predictions.map((p) => ({ imageBytes: p.bytesBase64Encoded }));
}

// ---------------------------------------------------------------------------
// Gemini Flash generateContent API (returns inline image)
// ---------------------------------------------------------------------------

async function callGenerateContentAPI(
  apiModel: string,
  prompt: string,
  aspectRatio: string | undefined,
  params: GenerationParams,
): Promise<{ imageBytes: string }[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY environment variable is not set");

  const url = `${GEMINI_API_BASE}/models/${apiModel}:generateContent?key=${apiKey}`;

  const imageConfig: Record<string, unknown> = {
    aspectRatio: aspectRatio ?? "1:1",
  };

  if (params.resolution) imageConfig.imageSize = params.resolution;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini image generation failed (${response.status}): ${summarizeProviderError(errorBody)}`);
  }

  const data = (await response.json()) as {
    candidates?: {
      content?: {
        parts?: { inlineData?: { data: string; mimeType: string } }[];
      };
    }[];
  };

  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error("Gemini API returned no image content");

  const images = parts
    .filter((p) => p.inlineData?.data)
    .map((p) => ({ imageBytes: p.inlineData!.data }));

  if (images.length === 0) throw new Error("Gemini API returned no images");

  return images;
}

// ---------------------------------------------------------------------------
// Resolution helper
// ---------------------------------------------------------------------------

function resolutionForAspectRatio(
  ratio: string,
  isFlash: boolean,
): { width: number; height: number } {
  if (isFlash) {
    // Flash models generate at lower resolution
    switch (ratio) {
      case "16:9": return { width: 1024, height: 576 };
      case "9:16": return { width: 576, height: 1024 };
      case "4:3": return { width: 896, height: 672 };
      case "3:4": return { width: 672, height: 896 };
      case "1:1":
      default: return { width: 768, height: 768 };
    }
  }
  switch (ratio) {
    case "16:9": return { width: 1792, height: 1008 };
    case "9:16": return { width: 1008, height: 1792 };
    case "4:3": return { width: 1344, height: 1008 };
    case "3:4": return { width: 1008, height: 1344 };
    case "1:1":
    default: return { width: 1024, height: 1024 };
  }
}

// ---------------------------------------------------------------------------
// Unified generate
// ---------------------------------------------------------------------------

function createGenerate(defaultVariantId: ModelId) {
  return async function generate(params: GenerationParams): Promise<GenerationResult> {
    const startTime = Date.now();

    try {
      const aspectRatio = params.aspectRatio ?? "1:1";

      if (!SUPPORTED_ASPECT_RATIOS.includes(aspectRatio)) {
        return {
          status: "failed",
          error: `Unsupported aspect ratio "${aspectRatio}". Supported: ${SUPPORTED_ASPECT_RATIOS.join(", ")}`,
        };
      }

      const variant = VARIANTS[defaultVariantId];
      if (!variant) {
        return { status: "failed", error: `Unknown Imagen variant: ${defaultVariantId}` };
      }

      let predictions: { imageBytes: string }[];

      if (variant.apiStyle === "predict") {
        const numImages = Math.min(params.numImages ?? 1, capabilities.maxBatchSize);
        predictions = await callPredictAPI(
          variant.apiModel,
          params.enhancedPrompt ?? params.prompt,
          aspectRatio,
          numImages,
          params,
        );
      } else {
        // Flash models use generateContent — single image at a time
        predictions = await callGenerateContentAPI(
          variant.apiModel,
          params.enhancedPrompt ?? params.prompt,
          aspectRatio,
          params,
        );
      }

      const imageBuffer = Buffer.from(predictions[0].imageBytes, "base64");
      const isFlash = variant.apiStyle === "generateContent";
      const { width, height } = resolutionForAspectRatio(aspectRatio, isFlash);

      return {
        status: "completed",
        imageBuffer,
        width,
        height,
        durationMs: Date.now() - startTime,
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown error during generation";
      return {
        status: "failed",
        error: message,
        durationMs: Date.now() - startTime,
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Exported providers — one per variant so the registry can look them up by ID
// ---------------------------------------------------------------------------

export const imagenProvider: GenerationProvider = {
  id: "imagen-4",
  name: "Gemini",
  provider: "google",
  capabilities,
  mediaType: "image",
  costPerImage: 0.04,
  generate: createGenerate("imagen-4"),
};

export const imagenFlashProvider: GenerationProvider = {
  id: "imagen-flash",
  name: "Gemini",
  provider: "google",
  capabilities: flashCapabilities,
  mediaType: "image",
  costPerImage: 0.002,
  generate: createGenerate("imagen-flash"),
};

export const imagenFlashLiteProvider: GenerationProvider = {
  id: "imagen-flash-lite",
  name: "Gemini",
  provider: "google",
  capabilities: flashCapabilities,
  mediaType: "image",
  costPerImage: 0.001,
  generate: createGenerate("imagen-flash-lite"),
};

export const imagenUltraProvider: GenerationProvider = {
  id: "imagen-4-ultra",
  name: "Gemini",
  provider: "google",
  capabilities,
  mediaType: "image",
  costPerImage: 0.08,
  generate: createGenerate("imagen-4-ultra"),
};

export const imagenFastProvider: GenerationProvider = {
  id: "imagen-4-fast",
  name: "Gemini",
  provider: "google",
  capabilities,
  mediaType: "image",
  costPerImage: 0.02,
  generate: createGenerate("imagen-4-fast"),
};
