import type { GenerationProvider, GenerationParams, GenerationResult } from "@/types";

const LUMA_API_BASE = "https://api.lumalabs.ai/dream-machine/v1";

function getApiKey(): string {
  const key = process.env.LUMA_API_KEY;
  if (!key) throw new Error("LUMA_API_KEY is not set");
  return key;
}

/**
 * Map camera control names to Luma API format.
 */
const CAMERA_MOTIONS: Record<string, { type: string; [k: string]: unknown }> = {
  "pan-left": { type: "camera_motion", value: "pan:left" },
  "pan-right": { type: "camera_motion", value: "pan:right" },
  "zoom-in": { type: "camera_motion", value: "zoom:in" },
  "zoom-out": { type: "camera_motion", value: "zoom:out" },
  "orbit-left": { type: "camera_motion", value: "orbit:left" },
  "orbit-right": { type: "camera_motion", value: "orbit:right" },
};

/**
 * Submit a video generation request to Luma Ray 2.
 */
async function submitGeneration(
  prompt: string,
  params: GenerationParams,
  apiKey: string
): Promise<string> {
  const body: Record<string, unknown> = {
    model: "ray-2",
    prompt,
    aspect_ratio: params.aspectRatio ?? "16:9",
    duration: params.duration ? `${params.duration}s` : "5s",
    resolution: params.resolution ?? "720p",
  };

  // Image-to-video
  if (params.imageInput) {
    body.keyframes = {
      frame0: {
        type: "image",
        url: params.imageInput,
      },
    };
  }

  // Camera control
  if (params.cameraControl && CAMERA_MOTIONS[params.cameraControl]) {
    body.camera_motion = CAMERA_MOTIONS[params.cameraControl];
  }

  if (params.loop !== undefined) {
    body.loop = params.loop;
  }

  const response = await fetch(`${LUMA_API_BASE}/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Luma API submission failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

/**
 * Poll a Luma generation for its status.
 */
async function pollGeneration(
  generationId: string,
  apiKey: string
): Promise<{
  state: string;
  assets?: { video?: string; thumbnail?: string };
  failure_reason?: string;
}> {
  const response = await fetch(
    `${LUMA_API_BASE}/generations/${generationId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Luma poll failed (${response.status}): ${text}`);
  }

  return response.json();
}

export const lumaFlashProvider: GenerationProvider = {
  id: "ray-flash-2",
  name: "Ray Flash 2",
  provider: "luma",
  mediaType: "video",
  capabilities: {
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"],
    supportsNegativePrompt: false,
    supportsBatchGeneration: false,
    maxBatchSize: 1,
    maxDuration: 15,
    supportedDurations: [5, 9],
    supportsAudio: false,
    supportsImageToVideo: true,
    supportsCameraControl: true,
    supportsLoop: true,
    resolutions: ["540p", "720p", "1080p", "4k"],
  },
  costPerImage: 0,
  costPerSecond: 0.025,
  async generate(params) {
    const apiKey = getApiKey();
    const prompt = params.enhancedPrompt || params.prompt;
    const body: Record<string, unknown> = {
      model: "ray-flash-2",
      prompt,
      aspect_ratio: params.aspectRatio ?? "16:9",
      duration: params.duration ? `${params.duration}s` : "5s",
      resolution: params.resolution ?? "720p",
    };
    if (params.imageInput) {
      body.keyframes = { frame0: { type: "image", url: params.imageInput } };
    }
    if (params.cameraControl && CAMERA_MOTIONS[params.cameraControl]) {
      body.camera_motion = CAMERA_MOTIONS[params.cameraControl];
    }
    if (params.loop !== undefined) body.loop = params.loop;

    const response = await fetch("https://api.lumalabs.ai/dream-machine/v1/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      return { status: "failed" as const, error: `Luma Flash failed (${response.status}): ${text}` };
    }
    const data = (await response.json()) as { id: string };
    return { status: "processing" as const, jobId: data.id };
  },
  async getStatus(jobId: string) {
    return lumaProvider.getStatus!(jobId);
  },
};

export const lumaProvider: GenerationProvider = {
  id: "ray-2",
  name: "Ray 2",
  provider: "luma",
  mediaType: "video",
  capabilities: {
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"],
    supportsNegativePrompt: false,
    supportsBatchGeneration: false,
    maxBatchSize: 1,
    maxDuration: 10, // extendable to 60s with multi-gen
    supportedDurations: [5, 10],
    supportsAudio: false,
    supportsImageToVideo: true,
    supportsCameraControl: true,
    supportsLoop: true,
    resolutions: ["540p", "720p", "1080p", "4k"],
  },
  costPerImage: 0,
  costPerSecond: 0.07,

  async generate(params: GenerationParams): Promise<GenerationResult> {
    try {
      const apiKey = getApiKey();
      const prompt = params.enhancedPrompt || params.prompt;
      const jobId = await submitGeneration(prompt, params, apiKey);

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
      const result = await pollGeneration(jobId, apiKey);

      if (result.state === "completed" && result.assets?.video) {
        return {
          status: "completed",
          videoUrl: result.assets.video,
          posterUrl: result.assets.thumbnail,
        };
      }

      if (result.state === "failed") {
        return {
          status: "failed",
          error: result.failure_reason ?? "Luma generation failed",
        };
      }

      // queued, dreaming
      return { status: "processing" };
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
