import type { GenerationProvider, GenerationParams, GenerationResult } from "@/types";

const RUNWAY_API_BASE = "https://api.dev.runwayml.com/v1";

function getApiKey(): string {
  const key = process.env.RUNWAY_API_KEY;
  if (!key) throw new Error("RUNWAY_API_KEY is not set");
  return key;
}

const ASPECT_RATIO_TO_PIXELS: Record<string, string> = {
  "16:9": "1280:720",
  "9:16": "720:1280",
  "1:1": "960:960",
  "4:3": "1104:832",
  "3:4": "832:1104",
};

/**
 * Submit a video generation task to Runway.
 */
async function submitTask(
  prompt: string,
  params: GenerationParams,
  apiKey: string
): Promise<string> {
  const ratio = ASPECT_RATIO_TO_PIXELS[params.aspectRatio ?? "16:9"] ?? "1280:720";

  // Determine endpoint and body based on whether we have an image input
  const hasImage = !!params.imageInput;
  const endpoint = hasImage ? "image_to_video" : "text_to_video";

  const body: Record<string, unknown> = {
    model: hasImage ? "gen4_turbo" : "gen4.5",
    promptText: prompt,
    duration: params.duration ?? 5,
    ratio,
  };

  if (hasImage) {
    body.promptImage = params.imageInput;
  }

  if (params.seed !== undefined) {
    body.seed = params.seed;
  }

  const response = await fetch(`${RUNWAY_API_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Runway-Version": "2024-11-06",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Runway API submission failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

/**
 * Poll a Runway task for its current status.
 */
async function pollTask(
  taskId: string,
  apiKey: string
): Promise<{
  status: string;
  output?: string[];
  failure?: string;
}> {
  const response = await fetch(`${RUNWAY_API_BASE}/tasks/${taskId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Runway-Version": "2024-11-06",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Runway poll failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<{
    status: string;
    output?: string[];
    failure?: string;
  }>;
}

export const runwayGen45Provider: GenerationProvider = {
  id: "runway-gen4.5",
  name: "Gen-4.5",
  provider: "runway",
  mediaType: "video",
  capabilities: {
    aspectRatios: ["16:9", "9:16", "1:1"],
    supportsNegativePrompt: false,
    supportsSeed: true,
    supportsBatchGeneration: false,
    maxBatchSize: 1,
    maxDuration: 10,
    supportedDurations: [5, 10],
    supportsAudio: false,
    supportsImageToVideo: true,
    resolutions: ["720p", "1080p"],
  },
  costPerImage: 0,
  costPerSecond: 0.10,
  async generate(params) {
    // gen4.5 supports both text and image to video
    const apiKey = getApiKey();
    const ratio = ASPECT_RATIO_TO_PIXELS[params.aspectRatio ?? "16:9"] ?? "1280:720";
    const hasImage = !!params.imageInput;
    const endpoint = hasImage ? "image_to_video" : "text_to_video";
    const body: Record<string, unknown> = {
      model: "gen4.5",
      promptText: params.enhancedPrompt || params.prompt,
      duration: params.duration ?? 5,
      ratio,
    };
    if (hasImage) body.promptImage = params.imageInput;
    if (params.seed !== undefined) body.seed = params.seed;

    const response = await fetch(`${RUNWAY_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Runway-Version": "2024-11-06",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      return { status: "failed" as const, error: `Runway API failed (${response.status}): ${text}` };
    }
    const data = (await response.json()) as { id: string };
    return { status: "processing" as const, jobId: data.id };
  },
  async getStatus(jobId: string) {
    return runwayProvider.getStatus!(jobId);
  },
};

export const runwayProvider: GenerationProvider = {
  id: "runway-gen4-turbo",
  name: "Gen-4 Turbo",
  provider: "runway",
  mediaType: "video",
  capabilities: {
    aspectRatios: ["16:9", "9:16", "1:1"],
    supportsNegativePrompt: false,
    supportsSeed: true,
    supportsBatchGeneration: false,
    maxBatchSize: 1,
    maxDuration: 10,
    supportedDurations: [5, 10],
    supportsAudio: false,
    supportsImageToVideo: true,
    resolutions: ["720p", "1080p"],
  },
  costPerImage: 0,
  costPerSecond: 0.05,

  async generate(params: GenerationParams): Promise<GenerationResult> {
    try {
      const apiKey = getApiKey();
      const prompt = params.enhancedPrompt || params.prompt;
      const jobId = await submitTask(prompt, params, apiKey);

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
  },

  async getStatus(jobId: string): Promise<GenerationResult> {
    try {
      const apiKey = getApiKey();
      const result = await pollTask(jobId, apiKey);

      if (result.status === "SUCCEEDED" && result.output?.[0]) {
        return {
          status: "completed",
          videoUrl: result.output[0],
          duration: 5, // Runway doesn't return duration in response
        };
      }

      if (result.status === "FAILED") {
        return {
          status: "failed",
          error: result.failure ?? "Runway generation failed",
        };
      }

      // PENDING, THROTTLED, RUNNING
      return { status: "processing" };
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
