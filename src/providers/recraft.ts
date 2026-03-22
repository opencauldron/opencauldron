import type { GenerationProvider, GenerationParams, GenerationResult, ModelId } from "@/types";

const RECRAFT_API_URL = "https://external.api.recraft.ai/v1/images/generations";

const ASPECT_RATIO_TO_SIZE: Record<string, string> = {
  "1:1": "1024x1024",
  "16:9": "1536x1024",
  "9:16": "1024x1536",
  "4:3": "1152x864",
  "3:4": "864x1152",
  "3:2": "1248x832",
  "2:3": "832x1248",
  "2:1": "1536x768",
  "1:2": "768x1536",
};

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

const VALID_STYLES = [
  "realistic_image",
  "digital_illustration",
  "vector_illustration",
  "icon",
  "realistic_image/b_and_w",
  "realistic_image/hdr",
  "realistic_image/natural_light",
  "realistic_image/studio_portrait",
  "digital_illustration/pixel_art",
  "digital_illustration/hand_drawn",
  "digital_illustration/watercolor",
  "digital_illustration/psychedelic",
] as const;

type RecraftStyle = (typeof VALID_STYLES)[number];

const API_MODELS: Record<string, string> = {
  "recraft-v3": "recraftv3",
  "recraft-20b": "recraft20b",
  "recraft-v4": "recraftv4",
  "recraft-v4-pro": "recraftv4_pro",
};

interface RecraftApiResponse {
  data: Array<{ b64_json: string }>;
}

function createRecraftGenerate(variantId: ModelId) {
  const apiModel = API_MODELS[variantId] ?? "recraftv3";

  return async function generate(params: GenerationParams): Promise<GenerationResult> {
    const startTime = Date.now();

    const apiKey = process.env.RECRAFT_API_KEY;
    if (!apiKey) {
      return {
        status: "failed",
        error: "RECRAFT_API_KEY environment variable is not set",
        durationMs: Date.now() - startTime,
      };
    }

    const aspectRatio = params.aspectRatio ?? "1:1";
    const size = ASPECT_RATIO_TO_SIZE[aspectRatio];
    if (!size) {
      return {
        status: "failed",
        error: `Unsupported aspect ratio: ${aspectRatio}. Supported: ${Object.keys(ASPECT_RATIO_TO_SIZE).join(", ")}`,
        durationMs: Date.now() - startTime,
      };
    }

    const dimensions = ASPECT_RATIO_DIMENSIONS[aspectRatio];

    const style: RecraftStyle =
      params.style && VALID_STYLES.includes(params.style as RecraftStyle)
        ? (params.style as RecraftStyle)
        : "realistic_image";

    const body: Record<string, unknown> = {
      prompt: params.enhancedPrompt ?? params.prompt,
      model: apiModel,
      size,
      response_format: "b64_json",
      style,
    };

    if (params.numImages) {
      body.n = params.numImages;
    }

    if (params.negativePrompt) {
      body.negative_prompt = params.negativePrompt;
    }

    if (params.cfgScale !== undefined) {
      body.controls = {
        artistic_level: Math.round(params.cfgScale),
      };
    }

    try {
      const response = await fetch(RECRAFT_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error?.message ?? errorJson.message ?? errorText;
        } catch {
          errorMessage = errorText;
        }
        return {
          status: "failed",
          error: `Recraft API error (${response.status}): ${errorMessage}`,
          durationMs: Date.now() - startTime,
        };
      }

      const result: RecraftApiResponse = await response.json();

      if (!result.data?.[0]?.b64_json) {
        return {
          status: "failed",
          error: "Recraft API returned an unexpected response format",
          durationMs: Date.now() - startTime,
        };
      }

      const imageBuffer = Buffer.from(result.data[0].b64_json, "base64");

      return {
        status: "completed",
        imageBuffer,
        width: dimensions.width,
        height: dimensions.height,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: "failed",
        error: `Recraft generation failed: ${message}`,
        durationMs: Date.now() - startTime,
      };
    }
  };
}

const capabilities = {
  aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2"],
  styles: [...VALID_STYLES],
  supportsNegativePrompt: true,
  supportsBatchGeneration: true,
  maxBatchSize: 6,
};

export async function recraftImageToImage(
  prompt: string,
  imageUrl: string,
  strength: number,
  params: GenerationParams,
): Promise<GenerationResult> {
  const startTime = Date.now();
  const apiKey = process.env.RECRAFT_API_KEY;
  if (!apiKey) return { status: "failed", error: "RECRAFT_API_KEY not set" };

  const aspectRatio = params.aspectRatio ?? "1:1";
  const size = ASPECT_RATIO_TO_SIZE[aspectRatio];
  if (!size) return { status: "failed", error: `Unsupported aspect ratio: ${aspectRatio}` };
  const dimensions = ASPECT_RATIO_DIMENSIONS[aspectRatio];

  const style = params.style && VALID_STYLES.includes(params.style as RecraftStyle)
    ? params.style : "realistic_image";

  try {
    const response = await fetch("https://external.api.recraft.ai/v1/images/imageToImage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        image_url: imageUrl,
        strength: strength ?? 0.5,
        model: "recraftv3",
        size,
        response_format: "b64_json",
        style,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { status: "failed", error: `Recraft i2i error (${response.status}): ${errorText}`, durationMs: Date.now() - startTime };
    }

    const result = (await response.json()) as { data: Array<{ b64_json: string }> };
    if (!result.data?.[0]?.b64_json) return { status: "failed", error: "No image returned", durationMs: Date.now() - startTime };

    return {
      status: "completed",
      imageBuffer: Buffer.from(result.data[0].b64_json, "base64"),
      width: dimensions.width,
      height: dimensions.height,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startTime };
  }
}

export async function upscaleRecraftImage(
  imageUrl: string,
  mode: "crisp" | "creative" = "crisp",
): Promise<GenerationResult> {
  const startTime = Date.now();
  const apiKey = process.env.RECRAFT_API_KEY;
  if (!apiKey) return { status: "failed", error: "RECRAFT_API_KEY not set" };

  const endpoint = mode === "creative"
    ? "https://external.api.recraft.ai/v1/images/creativeUpscale"
    : "https://external.api.recraft.ai/v1/images/crispUpscale";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: imageUrl,
        response_format: "b64_json",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { status: "failed", error: `Recraft upscale error (${response.status}): ${errorText}`, durationMs: Date.now() - startTime };
    }

    const result = (await response.json()) as { data: Array<{ b64_json: string }> };
    if (!result.data?.[0]?.b64_json) return { status: "failed", error: "No image returned", durationMs: Date.now() - startTime };

    return {
      status: "completed",
      imageBuffer: Buffer.from(result.data[0].b64_json, "base64"),
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startTime };
  }
}

export async function removeRecraftBackground(
  imageUrl: string,
): Promise<GenerationResult> {
  const startTime = Date.now();
  const apiKey = process.env.RECRAFT_API_KEY;
  if (!apiKey) return { status: "failed", error: "RECRAFT_API_KEY not set" };

  try {
    const response = await fetch("https://external.api.recraft.ai/v1/images/removeBackground", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: imageUrl,
        response_format: "b64_json",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { status: "failed", error: `Recraft bg removal error (${response.status}): ${errorText}`, durationMs: Date.now() - startTime };
    }

    const result = (await response.json()) as { data: Array<{ b64_json: string }> };
    if (!result.data?.[0]?.b64_json) return { status: "failed", error: "No image returned", durationMs: Date.now() - startTime };

    return {
      status: "completed",
      imageBuffer: Buffer.from(result.data[0].b64_json, "base64"),
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startTime };
  }
}

export async function vectorizeRecraftImage(
  imageUrl: string,
): Promise<GenerationResult> {
  const startTime = Date.now();
  const apiKey = process.env.RECRAFT_API_KEY;
  if (!apiKey) return { status: "failed", error: "RECRAFT_API_KEY not set" };

  try {
    const response = await fetch("https://external.api.recraft.ai/v1/images/vectorize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ image_url: imageUrl }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { status: "failed", error: `Recraft vectorize error (${response.status}): ${errorText}`, durationMs: Date.now() - startTime };
    }

    const result = (await response.json()) as { data: Array<{ url: string }> };
    if (!result.data?.[0]?.url) return { status: "failed", error: "No SVG returned", durationMs: Date.now() - startTime };

    return {
      status: "completed",
      imageUrl: result.data[0].url,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startTime };
  }
}

export const recraftProvider: GenerationProvider = {
  id: "recraft-v3",
  name: "Recraft",
  provider: "recraft",
  capabilities,
  mediaType: "image",
  costPerImage: 0.04,
  generate: createRecraftGenerate("recraft-v3"),
};

export const recraft20bProvider: GenerationProvider = {
  id: "recraft-20b",
  name: "Recraft",
  provider: "recraft",
  capabilities,
  mediaType: "image",
  costPerImage: 0.02,
  generate: createRecraftGenerate("recraft-20b"),
};

export const recraftV4Provider: GenerationProvider = {
  id: "recraft-v4",
  name: "Recraft",
  provider: "recraft",
  capabilities,
  mediaType: "image",
  costPerImage: 0.04,
  generate: createRecraftGenerate("recraft-v4"),
};

export const recraftV4ProProvider: GenerationProvider = {
  id: "recraft-v4-pro",
  name: "Recraft",
  provider: "recraft",
  capabilities,
  mediaType: "image",
  costPerImage: 0.08,
  generate: createRecraftGenerate("recraft-v4-pro"),
};
