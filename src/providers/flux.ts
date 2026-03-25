import type { GenerationProvider, GenerationParams, GenerationResult, ModelId } from "@/types";

const BFL_API_BASE = "https://api.bfl.ai/v1";
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_DURATION_MS = 60000;

const ASPECT_RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1376, height: 768 },
  "9:16": { width: 768, height: 1376 },
  "4:3": { width: 1184, height: 880 },
  "3:4": { width: 880, height: 1184 },
};

const API_ENDPOINTS: Record<string, string> = {
  "flux-1.1-pro": "flux-pro-1.1",
  "flux-dev": "flux-dev",
  "flux-kontext-pro": "flux-kontext-pro",
  "flux-2-klein": "flux-2-klein-9b",
};

function getApiKey(): string {
  const key = process.env.BFL_API_KEY;
  if (!key) {
    throw new Error("BFL_API_KEY environment variable is not set");
  }
  return key;
}

function getDimensions(aspectRatio?: string): { width: number; height: number } {
  if (!aspectRatio || !ASPECT_RATIO_DIMENSIONS[aspectRatio]) {
    return ASPECT_RATIO_DIMENSIONS["1:1"];
  }
  return ASPECT_RATIO_DIMENSIONS[aspectRatio];
}

async function submitJob(
  endpoint: string,
  prompt: string,
  width: number,
  height: number,
  apiKey: string,
  params: GenerationParams
): Promise<{ id: string; pollingUrl?: string }> {
  const body: Record<string, unknown> = { prompt, width, height, safety_tolerance: 2 };

  if (params.seed != null) {
    body.seed = params.seed;
  }
  if (params.outputFormat) {
    body.output_format = params.outputFormat;
  }
  if (params.promptEnhance != null) {
    body.prompt_upsampling = params.promptEnhance;
  }

  // flux-dev specific parameters
  if (endpoint === "flux-dev") {
    if (params.steps != null) {
      body.steps = params.steps;
    }
    if (params.guidance != null) {
      body.guidance = params.guidance;
    }
  }

  const response = await fetch(`${BFL_API_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`BFL API submission failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { id: string; polling_url?: string };
  return { id: data.id, pollingUrl: data.polling_url };
}

async function pollForResult(
  jobId: string,
  apiKey: string,
  pollingUrl?: string
): Promise<{ status: string; sample?: string }> {
  const url = pollingUrl ?? `${BFL_API_BASE}/get_result?id=${jobId}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { "x-key": apiKey },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`BFL API poll failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    status: "Pending" | "Ready" | "Error";
    result?: { sample: string };
  };

  return {
    status: data.status,
    sample: data.result?.sample,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFluxGenerate(variantId: ModelId) {
  const endpoint = API_ENDPOINTS[variantId] ?? "flux-pro-1.1";

  return async function generate(params: GenerationParams): Promise<GenerationResult> {
    const startTime = Date.now();

    try {
      const apiKey = getApiKey();
      const { width, height } = getDimensions(params.aspectRatio);
      const prompt = params.enhancedPrompt || params.prompt;

      const { id: jobId, pollingUrl } = await submitJob(endpoint, prompt, width, height, apiKey, params);

      const deadline = Date.now() + MAX_POLL_DURATION_MS;

      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);

        const pollResult = await pollForResult(jobId, apiKey, pollingUrl);

        if (pollResult.status === "Ready" && pollResult.sample) {
          const imageResponse = await fetch(pollResult.sample);
          if (!imageResponse.ok) {
            throw new Error(
              `Failed to download generated image (${imageResponse.status})`
            );
          }

          const arrayBuffer = await imageResponse.arrayBuffer();
          const imageBuffer = Buffer.from(arrayBuffer);

          return {
            status: "completed",
            imageUrl: pollResult.sample,
            imageBuffer,
            width,
            height,
            durationMs: Date.now() - startTime,
          };
        }

        if (pollResult.status === "Error") {
          return {
            status: "failed",
            error: "BFL API returned an error during generation",
            durationMs: Date.now() - startTime,
          };
        }
      }

      return {
        status: "failed",
        error: `Generation timed out after ${MAX_POLL_DURATION_MS / 1000} seconds`,
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

async function getStatus(jobId: string): Promise<GenerationResult> {
  try {
    const apiKey = getApiKey();
    const pollResult = await pollForResult(jobId, apiKey);

    if (pollResult.status === "Ready" && pollResult.sample) {
      return { status: "completed", imageUrl: pollResult.sample };
    }
    if (pollResult.status === "Error") {
      return { status: "failed", error: "BFL API returned an error during generation" };
    }
    return { status: "processing" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const capabilities = {
  aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
  supportsNegativePrompt: false,
  supportsBatchGeneration: false,
  maxBatchSize: 1,
  supportsSeed: true,
  supportsOutputFormat: true,
  supportsLora: true,
};

const fluxDevCapabilities = {
  ...capabilities,
  supportsSteps: true,
  supportsGuidance: true,
};

export const fluxProvider: GenerationProvider = {
  id: "flux-1.1-pro",
  name: "Flux",
  provider: "bfl",
  capabilities,
  mediaType: "image",
  costPerImage: 0.04,
  generate: createFluxGenerate("flux-1.1-pro"),
  getStatus,
};

export const fluxDevProvider: GenerationProvider = {
  id: "flux-dev",
  name: "Flux",
  provider: "bfl",
  capabilities: fluxDevCapabilities,
  mediaType: "image",
  costPerImage: 0.025,
  generate: createFluxGenerate("flux-dev"),
  getStatus,
};

export const fluxKontextProvider: GenerationProvider = {
  id: "flux-kontext-pro",
  name: "Flux",
  provider: "bfl",
  capabilities,
  mediaType: "image",
  costPerImage: 0.04,
  generate: createFluxGenerate("flux-kontext-pro"),
  getStatus,
};

export const fluxKleinProvider: GenerationProvider = {
  id: "flux-2-klein",
  name: "Flux",
  provider: "bfl",
  capabilities,
  mediaType: "image",
  costPerImage: 0.015,
  generate: createFluxGenerate("flux-2-klein"),
  getStatus,
};
