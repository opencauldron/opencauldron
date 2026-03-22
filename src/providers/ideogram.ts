import type { GenerationProvider, GenerationParams, GenerationResult } from "@/types";

const IDEOGRAM_API_BASE = "https://api.ideogram.ai/v1/ideogram-v3";

// Map our aspect ratio format ("1:1") to Ideogram's format ("ASPECT_1_1")
const ASPECT_RATIO_MAP: Record<string, string> = {
  "1:1": "ASPECT_1_1",
  "16:9": "ASPECT_16_9",
  "9:16": "ASPECT_9_16",
  "4:3": "ASPECT_4_3",
  "3:4": "ASPECT_3_4",
  "3:2": "ASPECT_3_2",
  "2:3": "ASPECT_2_3",
  "5:4": "ASPECT_5_4",
  "4:5": "ASPECT_4_5",
  "2:1": "ASPECT_2_1",
  "1:2": "ASPECT_1_2",
};

// Map our style names to Ideogram's style_type enum
const STYLE_TYPE_MAP: Record<string, string> = {
  auto: "AUTO",
  general: "GENERAL",
  realistic: "REALISTIC",
  design: "DESIGN",
  "3d": "RENDER_3D",
  anime: "ANIME",
  woodcut: "WOODCUT",
  cinematic: "CINEMATIC",
  watercolor: "WATERCOLOR",
  sketch: "SKETCH",
  surreal: "SURREAL",
  photography: "PHOTOGRAPHY",
  "oil painting": "OIL_PAINTING",
  isometric: "ISOMETRIC",
};

interface IdeogramImageRequest {
  prompt: string;
  aspect_ratio: string;
  magic_prompt_option: "AUTO" | "ON" | "OFF";
  style_type: string;
  negative_prompt?: string;
  rendering_speed?: "TURBO" | "DEFAULT" | "QUALITY";
  seed?: number;
  num_images?: number;
}

interface IdeogramResponseItem {
  url: string;
  prompt: string;
  seed?: number;
}

interface IdeogramResponse {
  data: IdeogramResponseItem[];
}

export async function remixIdeogramImage(
  prompt: string,
  imageUrl: string,
  params: GenerationParams,
): Promise<GenerationResult> {
  const startTime = Date.now();
  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) return { status: "failed", error: "IDEOGRAM_API_KEY not set" };

  const aspectRatio = ASPECT_RATIO_MAP[params.aspectRatio ?? "1:1"] ?? "ASPECT_1_1";
  const styleType = STYLE_TYPE_MAP[params.style?.toLowerCase() ?? "auto"] ?? "AUTO";

  try {
    const response = await fetch("https://api.ideogram.ai/v1/ideogram-v3/remix", {
      method: "POST",
      headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        image_request: {
          prompt,
          aspect_ratio: aspectRatio,
          style_type: styleType,
          image_weight: 50,
        },
        image_url: imageUrl,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { status: "failed", error: `Ideogram remix error (${response.status}): ${errorBody}`, durationMs: Date.now() - startTime };
    }

    const result = (await response.json()) as { data: { url: string }[] };
    if (!result.data?.[0]) return { status: "failed", error: "No image returned", durationMs: Date.now() - startTime };

    const imageResponse = await fetch(result.data[0].url);
    if (!imageResponse.ok) return { status: "failed", error: "Failed to download result", durationMs: Date.now() - startTime };

    const arrayBuffer = await imageResponse.arrayBuffer();
    return {
      status: "completed",
      imageUrl: result.data[0].url,
      imageBuffer: Buffer.from(arrayBuffer),
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startTime };
  }
}

export async function upscaleIdeogramImage(
  imageUrl: string,
  resemblance: number = 50,
  detail: number = 50,
): Promise<GenerationResult> {
  const startTime = Date.now();
  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) return { status: "failed", error: "IDEOGRAM_API_KEY not set" };

  try {
    const response = await fetch("https://api.ideogram.ai/upscale", {
      method: "POST",
      headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        image_request: { image_url: imageUrl },
        upscale_options: { resemblance, detail },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { status: "failed", error: `Ideogram upscale error (${response.status}): ${errorBody}`, durationMs: Date.now() - startTime };
    }

    const result = (await response.json()) as { data: { url: string }[] };
    if (!result.data?.[0]) return { status: "failed", error: "No image returned", durationMs: Date.now() - startTime };

    const imageResponse = await fetch(result.data[0].url);
    if (!imageResponse.ok) return { status: "failed", error: "Failed to download upscaled image", durationMs: Date.now() - startTime };

    const arrayBuffer = await imageResponse.arrayBuffer();
    return {
      status: "completed",
      imageUrl: result.data[0].url,
      imageBuffer: Buffer.from(arrayBuffer),
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startTime };
  }
}

export const ideogramProvider: GenerationProvider = {
  id: "ideogram-3",
  name: "Ideogram",
  provider: "ideogram",
  capabilities: {
    aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "2:1", "1:2"],
    styles: ["auto", "general", "realistic", "design", "3d", "anime", "woodcut", "cinematic", "watercolor", "sketch", "surreal", "photography", "oil painting", "isometric"],
    supportsNegativePrompt: true,
    supportsSeed: true,
    supportsRenderingSpeed: true,
    supportsBatchGeneration: true,
    maxBatchSize: 8,
  },
  mediaType: "image",
  costPerImage: 0.06,

  async generate(params: GenerationParams): Promise<GenerationResult> {
    const startTime = Date.now();

    const apiKey = process.env.IDEOGRAM_API_KEY;
    if (!apiKey) {
      return {
        status: "failed",
        error: "IDEOGRAM_API_KEY environment variable is not set",
      };
    }

    // Map aspect ratio, defaulting to 1:1
    const aspectRatio =
      ASPECT_RATIO_MAP[params.aspectRatio ?? "1:1"] ?? "ASPECT_1_1";

    // Map style, defaulting to AUTO
    const styleType =
      STYLE_TYPE_MAP[params.style?.toLowerCase() ?? "auto"] ?? "AUTO";

    const imageRequest: IdeogramImageRequest = {
      prompt: params.enhancedPrompt ?? params.prompt,
      aspect_ratio: aspectRatio,
      magic_prompt_option: "AUTO",
      style_type: styleType,
    };

    if (params.negativePrompt) {
      imageRequest.negative_prompt = params.negativePrompt;
    }

    if (params.renderingSpeed) {
      imageRequest.rendering_speed = params.renderingSpeed as "TURBO" | "DEFAULT" | "QUALITY";
    }

    if (params.numImages) {
      imageRequest.num_images = params.numImages;
    }

    if (params.seed !== undefined) {
      imageRequest.seed = params.seed;
    }

    try {
      // Make the generation request using V3 endpoint
      const response = await fetch(`${IDEOGRAM_API_BASE}/generate`, {
        method: "POST",
        headers: {
          "Api-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ image_request: imageRequest }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          status: "failed",
          error: `Ideogram API error (${response.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const result = (await response.json()) as IdeogramResponse;

      if (!result.data || result.data.length === 0) {
        return {
          status: "failed",
          error: "Ideogram API returned no images",
          durationMs: Date.now() - startTime,
        };
      }

      const imageData = result.data[0];

      // Fetch the generated image from the URL
      const imageResponse = await fetch(imageData.url);

      if (!imageResponse.ok) {
        return {
          status: "failed",
          error: `Failed to download image from Ideogram (${imageResponse.status})`,
          durationMs: Date.now() - startTime,
        };
      }

      const arrayBuffer = await imageResponse.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);

      return {
        status: "completed",
        imageUrl: imageData.url,
        imageBuffer,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: "failed",
        error: `Ideogram generation failed: ${message}`,
        durationMs: Date.now() - startTime,
      };
    }
  },
};

export async function replaceIdeogramBackground(
  prompt: string,
  imageUrl: string,
): Promise<GenerationResult> {
  const startTime = Date.now();
  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) return { status: "failed", error: "IDEOGRAM_API_KEY not set" };

  try {
    const response = await fetch("https://api.ideogram.ai/v1/ideogram-v3/replace-background", {
      method: "POST",
      headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        image_request: { prompt },
        image_url: imageUrl,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { status: "failed", error: `Ideogram replace-bg error (${response.status}): ${errorBody}`, durationMs: Date.now() - startTime };
    }

    const result = (await response.json()) as { data: { url: string }[] };
    if (!result.data?.[0]) return { status: "failed", error: "No image returned", durationMs: Date.now() - startTime };

    const imageResponse = await fetch(result.data[0].url);
    if (!imageResponse.ok) return { status: "failed", error: "Failed to download result", durationMs: Date.now() - startTime };

    return {
      status: "completed",
      imageUrl: result.data[0].url,
      imageBuffer: Buffer.from(await imageResponse.arrayBuffer()),
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startTime };
  }
}

export async function generateIdeogramTransparent(
  prompt: string,
  params: GenerationParams,
): Promise<GenerationResult> {
  const startTime = Date.now();
  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) return { status: "failed", error: "IDEOGRAM_API_KEY not set" };

  const aspectRatio = ASPECT_RATIO_MAP[params.aspectRatio ?? "1:1"] ?? "ASPECT_1_1";

  try {
    const response = await fetch("https://api.ideogram.ai/v1/ideogram-v3/generate-transparent", {
      method: "POST",
      headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        image_request: {
          prompt,
          aspect_ratio: aspectRatio,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { status: "failed", error: `Ideogram transparent error (${response.status}): ${errorBody}`, durationMs: Date.now() - startTime };
    }

    const result = (await response.json()) as { data: { url: string }[] };
    if (!result.data?.[0]) return { status: "failed", error: "No image returned", durationMs: Date.now() - startTime };

    const imageResponse = await fetch(result.data[0].url);
    if (!imageResponse.ok) return { status: "failed", error: "Failed to download result", durationMs: Date.now() - startTime };

    return {
      status: "completed",
      imageUrl: result.data[0].url,
      imageBuffer: Buffer.from(await imageResponse.arrayBuffer()),
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startTime };
  }
}

export async function describeIdeogramImage(
  imageUrl: string,
): Promise<{ description: string } | { error: string }> {
  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) return { error: "IDEOGRAM_API_KEY not set" };

  try {
    const response = await fetch("https://api.ideogram.ai/describe", {
      method: "POST",
      headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { error: `Ideogram describe error (${response.status}): ${errorBody}` };
    }

    const result = (await response.json()) as { descriptions: { text: string }[] };
    return { description: result.descriptions?.[0]?.text ?? "" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
