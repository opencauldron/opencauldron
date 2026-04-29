import type { GenerationProvider, GenerationParams, GenerationResult } from "@/types";
import { summarizeProviderError } from "@/lib/provider-errors";

const MINIMAX_API_BASE = "https://api.minimax.chat/v1";

function getApiKey(): string {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) throw new Error("MINIMAX_API_KEY is not set");
  return key;
}

/**
 * Submit a video generation request to MiniMax Hailuo 2.3.
 */
async function submitGeneration(
  prompt: string,
  params: GenerationParams,
  apiKey: string
): Promise<string> {
  const body: Record<string, unknown> = {
    model: "MiniMax-Hailuo-2.3",
    prompt,
    duration: params.duration ?? 6,
  };

  // Image-to-video
  if (params.imageInput?.length) {
    body.model = "I2V-01-Director";
    body.first_frame_image = params.imageInput[0];
  }

  if (params.promptOptimizer !== undefined) {
    body.prompt_optimizer = params.promptOptimizer;
  }

  const response = await fetch(`${MINIMAX_API_BASE}/video_generation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Hailuo API submission failed (${response.status}): ${summarizeProviderError(text)}`);
  }

  const data = (await response.json()) as {
    task_id: string;
    base_resp?: { status_code: number; status_msg: string };
  };

  if (data.base_resp && data.base_resp.status_code !== 0) {
    throw new Error(`Hailuo API error: ${data.base_resp.status_msg}`);
  }

  return data.task_id;
}

/**
 * Poll a Hailuo task for completion.
 */
async function pollTask(
  taskId: string,
  apiKey: string
): Promise<{
  status: string;
  file_id?: string;
  download_url?: string;
}> {
  const response = await fetch(
    `${MINIMAX_API_BASE}/query/video_generation?task_id=${taskId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Hailuo poll failed (${response.status}): ${summarizeProviderError(text)}`);
  }

  const data = (await response.json()) as {
    status: string;
    file_id?: string;
  };

  // If completed, get download URL
  if (data.status === "Success" && data.file_id) {
    const fileRes = await fetch(
      `${MINIMAX_API_BASE}/files/retrieve?file_id=${data.file_id}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );

    if (fileRes.ok) {
      const fileData = (await fileRes.json()) as {
        file: { download_url: string };
      };
      return {
        status: data.status,
        file_id: data.file_id,
        download_url: fileData.file.download_url,
      };
    }
  }

  return { status: data.status };
}

export const hailuoFastProvider: GenerationProvider = {
  id: "hailuo-2.3-fast",
  name: "Hailuo 2.3",
  provider: "minimax",
  mediaType: "video",
  capabilities: {
    aspectRatios: ["16:9", "9:16", "1:1"],
    supportsNegativePrompt: false,
    supportsBatchGeneration: false,
    maxBatchSize: 1,
    maxDuration: 10,
    supportedDurations: [6, 10],
    supportsAudio: true,
    supportsImageToVideo: true,
    supportsPromptOptimizer: true,
    resolutions: ["720p", "1080p"],
  },
  costPerImage: 0,
  costPerSecond: 0.03,
  async generate(params) {
    const apiKey = getApiKey();
    const prompt = params.enhancedPrompt || params.prompt;
    const body: Record<string, unknown> = {
      model: "MiniMax-Hailuo-2.3-Fast",
      prompt,
      duration: params.duration ?? 6,
    };
    if (params.imageInput?.length) {
      body.model = "I2V-01-Director";
      body.first_frame_image = params.imageInput[0];
    }
    if (params.promptOptimizer !== undefined) body.prompt_optimizer = params.promptOptimizer;

    const response = await fetch("https://api.minimax.chat/v1/video_generation", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      return { status: "failed" as const, error: `Hailuo Fast failed (${response.status}): ${summarizeProviderError(text)}` };
    }
    const data = (await response.json()) as { task_id: string; base_resp?: { status_code: number; status_msg: string } };
    if (data.base_resp && data.base_resp.status_code !== 0) {
      return { status: "failed" as const, error: `Hailuo error: ${data.base_resp.status_msg}` };
    }
    return { status: "processing" as const, jobId: data.task_id };
  },
  async getStatus(jobId: string) {
    return hailuoProvider.getStatus!(jobId);
  },
};

export const hailuoProvider: GenerationProvider = {
  id: "hailuo-2.3",
  name: "Hailuo 2.3",
  provider: "minimax",
  mediaType: "video",
  capabilities: {
    aspectRatios: ["16:9", "9:16", "1:1"],
    supportsNegativePrompt: false,
    supportsBatchGeneration: false,
    maxBatchSize: 1,
    maxDuration: 10,
    supportedDurations: [6, 10],
    supportsAudio: true,
    supportsImageToVideo: true,
    supportsPromptOptimizer: true,
    resolutions: ["720p", "1080p"],
  },
  costPerImage: 0,
  costPerSecond: 0.045,

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
      const result = await pollTask(jobId, apiKey);

      if (result.status === "Success" && result.download_url) {
        return {
          status: "completed",
          videoUrl: result.download_url,
          hasAudio: true,
        };
      }

      if (result.status === "Fail") {
        return {
          status: "failed",
          error: "Hailuo generation failed",
        };
      }

      // Queueing, Processing
      return { status: "processing" };
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
