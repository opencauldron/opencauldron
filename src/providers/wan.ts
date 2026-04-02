import type { GenerationProvider, GenerationParams, GenerationResult } from "@/types";

const FAL_QUEUE_BASE = "https://queue.fal.run";

function getApiKey(): string {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not set");
  return key;
}

/**
 * Pick the correct fal.ai endpoint based on whether LoRAs are present
 * and whether an input image is provided (I2V vs T2V).
 */
function resolveEndpoint(params: GenerationParams): string {
  const hasLora = params.loras && params.loras.length > 0;
  if (params.imageInput?.length) {
    return hasLora ? "fal-ai/wan-i2v-lora" : "fal-ai/wan-i2v";
  }
  return hasLora ? "fal-ai/wan-t2v-lora" : "fal-ai/wan-t2v";
}

/**
 * Submit a video generation request to Wan 2.1 via fal.ai.
 */
async function submitJob(
  prompt: string,
  params: GenerationParams,
  apiKey: string,
  endpoint: string,
): Promise<string> {
  const body: Record<string, unknown> = {
    prompt,
    aspect_ratio: params.aspectRatio ?? "16:9",
  };

  if (params.negativePrompt) {
    body.negative_prompt = params.negativePrompt;
  }

  if (params.seed != null) {
    body.seed = params.seed;
  }

  if (params.resolution) {
    body.resolution = params.resolution;
  }

  if (params.imageInput?.length) {
    body.image_url = params.imageInput[0];
  }

  if (params.loras && params.loras.length > 0) {
    body.loras = params.loras.map((l) => ({
      path: l.path,
      scale: l.scale,
    }));
  }

  const response = await fetch(`${FAL_QUEUE_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Wan/fal.ai submission failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { request_id: string };
  return data.request_id;
}

/**
 * Poll a fal.ai queue request for status.
 * The endpoint prefix must match the one used during submission.
 */
async function pollJob(
  requestId: string,
  apiKey: string,
  endpoint: string,
): Promise<{ status: string }> {
  const response = await fetch(
    `${FAL_QUEUE_BASE}/${endpoint}/requests/${requestId}/status`,
    {
      method: "GET",
      headers: { Authorization: `Key ${apiKey}` },
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Wan/fal.ai poll failed (${response.status}): ${text}`);
  }

  return response.json();
}

/**
 * Get the completed result from fal.ai.
 */
async function getResult(
  requestId: string,
  apiKey: string,
  endpoint: string,
): Promise<{ video: { url: string }; seed?: number }> {
  const response = await fetch(
    `${FAL_QUEUE_BASE}/${endpoint}/requests/${requestId}`,
    {
      method: "GET",
      headers: { Authorization: `Key ${apiKey}` },
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Wan/fal.ai result fetch failed (${response.status}): ${text}`);
  }

  return response.json();
}

/**
 * Encode the endpoint alongside the request ID so getStatus()
 * can reconstruct the correct poll URL. fal.ai requires the poll
 * URL to match the submission endpoint.
 */
function encodeJobId(endpoint: string, requestId: string): string {
  return `${endpoint}::${requestId}`;
}

function decodeJobId(jobId: string): { endpoint: string; requestId: string } {
  const sep = jobId.indexOf("::");
  if (sep === -1) {
    // Fallback: assume standard T2V if no prefix (shouldn't happen)
    return { endpoint: "fal-ai/wan-t2v", requestId: jobId };
  }
  return {
    endpoint: jobId.slice(0, sep),
    requestId: jobId.slice(sep + 2),
  };
}

export const wanProvider: GenerationProvider = {
  id: "wan-2.1",
  name: "Wan 2.1",
  provider: "fal",
  mediaType: "video",
  capabilities: {
    aspectRatios: ["16:9", "9:16"],
    supportsNegativePrompt: true,
    supportsBatchGeneration: false,
    maxBatchSize: 1,
    supportsSeed: true,
    supportsLora: true,
    supportsImageToVideo: true,
    supportsResolution: true,
    resolutionOptions: ["480p", "720p"],
    maxDuration: 5,
    supportedDurations: [5],
    supportsAudio: false,
    resolutions: ["720p"],
  },
  costPerImage: 0,
  costPerSecond: 0.035,

  async generate(params: GenerationParams): Promise<GenerationResult> {
    try {
      const apiKey = getApiKey();
      const prompt = params.enhancedPrompt || params.prompt;
      const endpoint = resolveEndpoint(params);
      const requestId = await submitJob(prompt, params, apiKey, endpoint);

      return {
        status: "processing",
        jobId: encodeJobId(endpoint, requestId),
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
      const { endpoint, requestId } = decodeJobId(jobId);
      const status = await pollJob(requestId, apiKey, endpoint);

      if (status.status === "COMPLETED") {
        const result = await getResult(requestId, apiKey, endpoint);
        return {
          status: "completed",
          videoUrl: result.video.url,
        };
      }

      if (status.status === "FAILED") {
        return {
          status: "failed",
          error: "Wan video generation failed",
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
