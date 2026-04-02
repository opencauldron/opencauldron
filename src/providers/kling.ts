import type { GenerationProvider, GenerationParams, GenerationResult } from "@/types";

const FAL_API_BASE = "https://queue.fal.run";

function getApiKey(): string {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not set");
  return key;
}

/**
 * Submit a video generation request to Kling 2.1 via fal.ai.
 */
async function submitJob(
  prompt: string,
  params: GenerationParams,
  apiKey: string
): Promise<string> {
  const endpoint = params.imageInput?.length
    ? "fal-ai/kling-video/v2.1/standard/image-to-video"
    : "fal-ai/kling-video/v2.1/standard/text-to-video";

  const body: Record<string, unknown> = {
    prompt,
    duration: String(params.duration ?? 5),
    aspect_ratio: params.aspectRatio ?? "16:9",
    negative_prompt: params.negativePrompt ?? "blur, distort, and low quality",
  };

  if (params.cfgScale != null) {
    body.cfg_scale = params.cfgScale;
  }

  if (params.imageInput?.length) {
    body.image_url = params.imageInput[0];
  }

  const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kling/fal.ai submission failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { request_id: string };
  return data.request_id;
}

/**
 * Poll a fal.ai queue request for status.
 */
async function pollJob(
  requestId: string,
  apiKey: string
): Promise<{
  status: string;
  response_url?: string;
  video?: { url: string };
}> {
  // fal.ai uses a status endpoint format
  const response = await fetch(
    `https://queue.fal.run/fal-ai/kling-video/requests/${requestId}/status`,
    {
      method: "GET",
      headers: {
        Authorization: `Key ${apiKey}`,
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kling/fal.ai poll failed (${response.status}): ${text}`);
  }

  return response.json();
}

/**
 * Get the completed result from fal.ai.
 */
async function getResult(
  requestId: string,
  apiKey: string
): Promise<{ video: { url: string }; thumbnail?: { url: string } }> {
  const response = await fetch(
    `https://queue.fal.run/fal-ai/kling-video/requests/${requestId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Key ${apiKey}`,
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kling/fal.ai result fetch failed (${response.status}): ${text}`);
  }

  return response.json();
}

export const klingProProvider: GenerationProvider = {
  id: "kling-2.1-pro",
  name: "Kling 2.1",
  provider: "fal",
  mediaType: "video",
  capabilities: {
    aspectRatios: ["16:9", "9:16", "1:1"],
    supportsNegativePrompt: true,
    supportsBatchGeneration: false,
    maxBatchSize: 1,
    supportsCfgScale: true,
    maxDuration: 10,
    supportedDurations: [5, 10],
    supportsAudio: false,
    supportsImageToVideo: true,
    resolutions: ["720p", "1080p"],
  },
  costPerImage: 0,
  costPerSecond: 0.15,
  async generate(params) {
    const apiKey = getApiKey();
    const prompt = params.enhancedPrompt || params.prompt;
    const endpoint = params.imageInput?.length
      ? "fal-ai/kling-video/v2.1/pro/image-to-video"
      : "fal-ai/kling-video/v2.1/pro/text-to-video";
    const body: Record<string, unknown> = {
      prompt,
      duration: String(params.duration ?? 5),
      aspect_ratio: params.aspectRatio ?? "16:9",
    };
    if (params.imageInput?.length) body.image_url = params.imageInput[0];
    if (params.negativePrompt) body.negative_prompt = params.negativePrompt;
    if (params.cfgScale != null) body.cfg_scale = params.cfgScale;

    const response = await fetch(`https://queue.fal.run/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Key ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      return { status: "failed" as const, error: `Kling Pro failed (${response.status}): ${text}` };
    }
    const data = (await response.json()) as { request_id: string };
    return { status: "processing" as const, jobId: data.request_id };
  },
  async getStatus(jobId: string) {
    return klingProvider.getStatus!(jobId);
  },
};

export const klingProvider: GenerationProvider = {
  id: "kling-2.1",
  name: "Kling 2.1",
  provider: "fal",
  mediaType: "video",
  capabilities: {
    aspectRatios: ["16:9", "9:16", "1:1"],
    supportsNegativePrompt: true,
    supportsBatchGeneration: false,
    maxBatchSize: 1,
    supportsCfgScale: true,
    maxDuration: 10,
    supportedDurations: [5, 10],
    supportsAudio: false,
    supportsImageToVideo: true,
    resolutions: ["720p", "1080p"],
  },
  costPerImage: 0,
  costPerSecond: 0.075,

  async generate(params: GenerationParams): Promise<GenerationResult> {
    try {
      const apiKey = getApiKey();
      const prompt = params.enhancedPrompt || params.prompt;
      const jobId = await submitJob(prompt, params, apiKey);

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
      const status = await pollJob(jobId, apiKey);

      if (status.status === "COMPLETED") {
        const result = await getResult(jobId, apiKey);
        return {
          status: "completed",
          videoUrl: result.video.url,
          posterUrl: result.thumbnail?.url,
        };
      }

      if (status.status === "FAILED") {
        return {
          status: "failed",
          error: "Kling generation failed",
        };
      }

      // IN_QUEUE, IN_PROGRESS
      return { status: "processing" };
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
