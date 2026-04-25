# Provider Implementation Patterns

Annotated examples from the codebase showing the two main patterns: synchronous (image) and asynchronous (video/polling).

## Pattern 1: Synchronous Image Provider (Grok / xAI)

This is the simplest pattern. The API returns the image directly in the response.

```typescript
import type {
  GenerationProvider,
  GenerationParams,
  GenerationResult,
  ModelId,
} from "@/types";

// 1. Map aspect ratios to pixel dimensions
//    Every image provider needs this. Use the provider's documented sizes,
//    or fall back to sensible defaults (~1 megapixel total).
const ASPECT_RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1536, height: 1024 },
  "9:16": { width: 1024, height: 1536 },
  "4:3": { width: 1152, height: 864 },
  "3:4": { width: 864, height: 1152 },
};

// 2. Map internal model IDs to the API's model identifiers
const API_MODELS: Record<string, string> = {
  "grok-imagine": "grok-imagine-image",
  "grok-imagine-pro": "grok-imagine-image-pro",
};

// 3. Factory function for variants that share API logic
//    This avoids code duplication when you have multiple model variants.
function createGrokGenerate(variantId: ModelId) {
  const apiModel = API_MODELS[variantId] ?? "grok-imagine-image";

  return async function generate(params: GenerationParams): Promise<GenerationResult> {
    const startTime = Date.now();

    // 4. Check API key first — return failed result, don't throw
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return {
        status: "failed",
        error: "XAI_API_KEY environment variable is not set",
      };
    }

    // 5. Resolve dimensions from aspect ratio
    const aspectRatio = params.aspectRatio ?? "1:1";
    const dimensions = ASPECT_RATIO_DIMENSIONS[aspectRatio] ?? ASPECT_RATIO_DIMENSIONS["1:1"];

    try {
      // 6. Make the API call
      const response = await fetch("https://api.x.ai/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: apiModel,
          prompt: params.enhancedPrompt ?? params.prompt, // prefer enhanced prompt
          n: Math.min(params.numImages ?? 1, 10),
          response_format: "b64_json",
          aspect_ratio: aspectRatio,
        }),
      });

      // 7. Handle API errors — extract meaningful message
      if (!response.ok) {
        const errorBody = await response.text();
        let errorMessage: string;
        try {
          const parsed = JSON.parse(errorBody);
          errorMessage = parsed.error?.message ?? parsed.error ?? errorBody;
        } catch {
          errorMessage = errorBody;
        }
        return {
          status: "failed",
          error: `xAI API error (${response.status}): ${errorMessage}`,
          durationMs: Date.now() - startTime,
        };
      }

      // 8. Parse response and decode image
      const data = (await response.json()) as { data: { b64_json: string }[] };
      if (!data.data || data.data.length === 0) {
        return {
          status: "failed",
          error: "xAI API returned no image data",
          durationMs: Date.now() - startTime,
        };
      }

      const imageBuffer = Buffer.from(data.data[0].b64_json, "base64");

      // 9. Return successful result with buffer + dimensions + timing
      return {
        status: "completed",
        imageBuffer,
        width: dimensions.width,
        height: dimensions.height,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      // 10. Catch network/unexpected errors — still return result, don't throw
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        status: "failed",
        error: `Grok image generation failed: ${message}`,
        durationMs: Date.now() - startTime,
      };
    }
  };
}

// 11. Define capabilities — what the UI should show for this provider
const capabilities = {
  aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
  supportsNegativePrompt: false,
  supportsBatchGeneration: true,
  maxBatchSize: 10,
  supportsResolution: true,
  resolutionOptions: ["1k", "2k"],
};

// 12. Export provider objects — one per variant
export const grokProvider: GenerationProvider = {
  id: "grok-imagine",
  name: "Grok",
  provider: "xai",
  capabilities,
  mediaType: "image",
  costPerImage: 0.02,
  generate: createGrokGenerate("grok-imagine"),
};

export const grokProProvider: GenerationProvider = {
  id: "grok-imagine-pro",
  name: "Grok",
  provider: "xai",
  capabilities,
  mediaType: "image",
  costPerImage: 0.07,
  generate: createGrokGenerate("grok-imagine-pro"),
};
```

## Pattern 2: Async Provider with Polling (Flux / BFL)

For providers that return a job ID and require polling for the result. Common for video providers and some image providers.

Key differences from the sync pattern:
- `generate()` returns `{ status: "processing", jobId }` immediately
- `getStatus(jobId)` is implemented to check job completion
- The system calls `getStatus()` to poll until done

```typescript
// generate() — submit the job
return async function generate(params: GenerationParams): Promise<GenerationResult> {
  const startTime = Date.now();
  // ... API key check, params setup ...

  try {
    const response = await fetch("https://api.bfl.ml/v1/flux-pro-1.1", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Key": apiKey,
      },
      body: JSON.stringify({ prompt, width, height, seed }),
    });

    const data = await response.json();

    // Return processing status with the job ID
    return {
      status: "processing",
      jobId: data.id,           // <-- the provider's job/task ID
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return { status: "failed", error: err.message, durationMs: Date.now() - startTime };
  }
};

// getStatus() — poll for completion
async function getStatus(jobId: string): Promise<GenerationResult> {
  const startTime = Date.now();
  const apiKey = process.env.BFL_API_KEY;

  try {
    const response = await fetch(
      `https://api.bfl.ml/v1/get_result?id=${jobId}`,
      { headers: { "X-Key": apiKey } }
    );
    const data = await response.json();

    if (data.status === "Ready") {
      // For images: fetch the URL and return buffer
      const imgResponse = await fetch(data.result.sample);
      const imageBuffer = Buffer.from(await imgResponse.arrayBuffer());
      return {
        status: "completed",
        imageBuffer,
        width: data.result.width,
        height: data.result.height,
        durationMs: Date.now() - startTime,
      };
    }

    if (data.status === "Error") {
      return { status: "failed", error: data.error, durationMs: Date.now() - startTime };
    }

    // Still processing
    return { status: "processing", jobId, durationMs: Date.now() - startTime };
  } catch (err) {
    return { status: "failed", error: err.message, durationMs: Date.now() - startTime };
  }
}
```

## Pattern 3: Video Provider (Runway)

Video providers are always async. The key difference is returning `videoUrl` instead of `imageBuffer`.

```typescript
// In getStatus(), when the video is ready:
return {
  status: "completed",
  videoUrl: data.output[0],    // URL to the video file
  duration: params.duration,   // actual duration in seconds
  hasAudio: false,
  durationMs: Date.now() - startTime,
};
```

## Common patterns across all providers

### API key environment variable naming
Follow the convention: `{VENDOR}_API_KEY` (e.g., `RUNWAY_API_KEY`, `MINIMAX_API_KEY`).
Exception: FAL uses `FAL_KEY`, Google uses `GEMINI_API_KEY`.

### Error response parsing
Always try to extract a useful error message from the response body:

```typescript
if (!response.ok) {
  const errorBody = await response.text();
  let errorMessage: string;
  try {
    const parsed = JSON.parse(errorBody);
    errorMessage = parsed.error?.message ?? parsed.error ?? parsed.detail ?? errorBody;
  } catch {
    errorMessage = errorBody;
  }
  return {
    status: "failed",
    error: `Provider API error (${response.status}): ${errorMessage}`,
    durationMs: Date.now() - startTime,
  };
}
```

### Prompt handling
Always prefer the enhanced prompt when available:
```typescript
const prompt = params.enhancedPrompt ?? params.prompt;
```

### Provider-specific aspect ratio formats
Some providers want different aspect ratio formats:
- Most: `"16:9"` (string with colon)
- Some: Separate `width` and `height` fields
- Some: `"16_9"` (underscore)

Check the API docs and convert accordingly.
