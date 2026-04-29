import type { GenerationProvider, GenerationParams, GenerationResult, ModelId, ModelCapabilities } from "@/types";
import { summarizeProviderError } from "@/lib/provider-errors";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return key;
}

const VEO_MODELS: Record<string, string> = {
  "veo-3": "veo-3",
  "veo-3.1": "veo-3.1-generate-preview",
  "veo-3-fast": "veo-3.0-fast-generate-001",
};

/**
 * Submit a video generation request to a Veo model via the Gemini API.
 * Returns an operation name for polling.
 */
async function submitGeneration(
  modelApiName: string,
  prompt: string,
  params: GenerationParams,
  apiKey: string
): Promise<string> {
  const parameters: Record<string, unknown> = {
    aspectRatio: params.aspectRatio ?? "16:9",
    durationSeconds: params.duration ?? 8,
    generateAudio: params.audioEnabled !== false,
    resolution: params.resolution ?? "720p",
    personGeneration: params.personGeneration ?? "allow_adult",
    compressionQuality: "optimized",
  };

  if (params.seed !== undefined) parameters.seed = params.seed;
  if (params.negativePrompt) parameters.negativePrompt = params.negativePrompt;

  const body: Record<string, unknown> = {
    instances: [{ prompt }],
    parameters,
  };

  // Image-to-video
  if (params.imageInput?.length) {
    body.instances = [{ prompt, image: { imageUri: params.imageInput[0] } }];
  }

  const url = `${GEMINI_API_BASE}/models/${modelApiName}:predictLongRunning?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Veo API submission failed (${response.status}): ${summarizeProviderError(text)}`);
  }

  const data = (await response.json()) as { name: string };
  return data.name;
}

/**
 * Poll a long-running operation for completion.
 */
async function pollOperation(
  operationName: string,
  apiKey: string
): Promise<{
  done: boolean;
  response?: {
    videos?: { video: { uri?: string; bytesBase64Encoded?: string } }[];
  };
  error?: { message: string };
}> {
  const url = `${GEMINI_API_BASE}/${operationName}?key=${apiKey}`;

  const response = await fetch(url, { method: "GET" });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Veo poll failed (${response.status}): ${summarizeProviderError(text)}`);
  }

  return response.json();
}

async function getStatus(jobId: string): Promise<GenerationResult> {
  try {
    const apiKey = getApiKey();
    const result = await pollOperation(jobId, apiKey);

    if (result.done && result.response?.videos?.[0]) {
      const video = result.response.videos[0].video;

      if (video.bytesBase64Encoded) {
        return {
          status: "completed",
          videoBuffer: Buffer.from(video.bytesBase64Encoded, "base64"),
          hasAudio: true,
        };
      }

      if (video.uri) {
        return {
          status: "completed",
          videoUrl: video.uri,
          hasAudio: true,
        };
      }
    }

    if (result.done && result.error) {
      return {
        status: "failed",
        error: result.error.message,
      };
    }

    return { status: "processing" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createVeoGenerate(variantId: ModelId) {
  const modelApiName = VEO_MODELS[variantId] ?? "veo-3";

  return async function generate(params: GenerationParams): Promise<GenerationResult> {
    try {
      const apiKey = getApiKey();
      const prompt = params.enhancedPrompt || params.prompt;
      const jobId = await submitGeneration(modelApiName, prompt, params, apiKey);

      return {
        status: "processing",
        jobId,
      };
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

const veo3Capabilities: ModelCapabilities = {
  aspectRatios: ["16:9", "9:16"],
  supportsNegativePrompt: true,
  supportsBatchGeneration: false,
  maxBatchSize: 1,
  maxDuration: 8,
  supportedDurations: [5, 8],
  supportsAudio: true,
  supportsImageToVideo: true,
  resolutions: ["720p", "1080p"],
  supportsSeed: true,
  supportsResolution: true,
  resolutionOptions: ["720p", "1080p", "4k"],
  supportsPersonGeneration: true,
};

export const veoProvider: GenerationProvider = {
  id: "veo-3",
  name: "Veo 3",
  provider: "google",
  mediaType: "video",
  capabilities: veo3Capabilities,
  costPerImage: 0,
  costPerSecond: 0.15,
  generate: createVeoGenerate("veo-3"),
  getStatus,
};

export const veo31Provider: GenerationProvider = {
  id: "veo-3.1",
  name: "Veo 3.1",
  provider: "google",
  mediaType: "video",
  capabilities: {
    ...veo3Capabilities,
    resolutionOptions: ["720p", "1080p", "4k"],
    supportedDurations: [4, 6, 8],
  },
  costPerImage: 0,
  costPerSecond: 0.15,
  generate: createVeoGenerate("veo-3.1"),
  getStatus,
};

export const veoFastProvider: GenerationProvider = {
  id: "veo-3-fast",
  name: "Veo 3",
  provider: "google",
  mediaType: "video",
  capabilities: veo3Capabilities,
  costPerImage: 0,
  costPerSecond: 0.08,
  generate: createVeoGenerate("veo-3-fast"),
  getStatus,
};
