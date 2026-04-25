# Provider Spec — TypeScript Interfaces

This is the exact contract every provider must satisfy. Copied from `src/types/index.ts`.

## GenerationProvider (the main interface)

```typescript
export interface GenerationProvider {
  id: ModelId;           // e.g. "my-model-v2"
  name: string;          // Display name, e.g. "My Model"
  provider: ProviderName; // Vendor key, e.g. "myvendor"
  mediaType: MediaType;  // "image" | "video"
  capabilities: ModelCapabilities;
  costPerImage: number;  // USD per image (0 for video-only)
  costPerSecond?: number; // USD per second (for video)
  generate(params: GenerationParams): Promise<GenerationResult>;
  getStatus?(jobId: string): Promise<GenerationResult>; // only for async providers
}
```

## GenerationParams (input to generate())

```typescript
export interface GenerationParams {
  prompt: string;
  enhancedPrompt?: string;      // prefer this over prompt when available
  model: ModelId;
  aspectRatio?: string;          // "1:1", "16:9", "9:16", "4:3", "3:4", etc.
  style?: string;
  negativePrompt?: string;
  quality?: "standard" | "high";
  numImages?: number;
  seed?: number;
  outputFormat?: "jpeg" | "png";
  resolution?: string;           // "720p", "1080p", "4k", "1K", "2K"
  guidance?: number;
  steps?: number;
  cfgScale?: number;
  renderingSpeed?: "TURBO" | "DEFAULT" | "QUALITY";
  personGeneration?: "dont_allow" | "allow_adult" | "allow_all";
  watermark?: boolean;
  promptEnhance?: boolean;
  promptOptimizer?: boolean;
  loop?: boolean;
  duration?: number;             // video duration in seconds
  imageInput?: string;           // R2 URL for image-to-video
  audioEnabled?: boolean;
  cameraControl?: string;
  loras?: Array<{ path: string; scale: number; triggerWords?: string[] }>;
  nsfwEnabled?: boolean;
  [key: string]: unknown;
}
```

## GenerationResult (output from generate())

```typescript
export interface GenerationResult {
  status: GenerationStatus;    // "pending" | "processing" | "completed" | "failed"
  // Image result (sync providers)
  imageUrl?: string;
  imageBuffer?: Buffer;        // the actual image bytes
  width?: number;
  height?: number;
  // Video result (async providers)
  videoUrl?: string;           // URL to download the video
  videoBuffer?: Buffer;
  posterUrl?: string;          // thumbnail frame
  duration?: number;           // actual duration in seconds
  hasAudio?: boolean;
  // Async job tracking
  jobId?: string;              // returned by generate(), used by getStatus()
  // Common
  error?: string;              // error message when status is "failed"
  durationMs?: number;         // wall clock time for the API call
}
```

## ModelCapabilities

```typescript
export interface ModelCapabilities {
  aspectRatios: string[];                    // required — which ratios are supported
  maxResolution?: { width: number; height: number };
  styles?: string[];
  supportsNegativePrompt: boolean;           // required
  supportsBatchGeneration: boolean;          // required
  maxBatchSize: number;                      // required
  // Optional flags
  supportsSeed?: boolean;
  supportsOutputFormat?: boolean;
  supportsResolution?: boolean;
  resolutionOptions?: string[];
  supportsGuidance?: boolean;
  supportsSteps?: boolean;
  supportsCfgScale?: boolean;
  supportsRenderingSpeed?: boolean;
  supportsColorPalette?: boolean;
  supportsPersonGeneration?: boolean;
  supportsWatermarkToggle?: boolean;
  supportsPromptEnhance?: boolean;
  supportsPromptOptimizer?: boolean;
  supportsLoop?: boolean;
  supportsLora?: boolean;
  // Video-specific
  maxDuration?: number;
  supportedDurations?: number[];
  supportsAudio?: boolean;
  supportsImageToVideo?: boolean;
  supportsCameraControl?: boolean;
  cameraMotions?: string[];
  resolutions?: ("540p" | "720p" | "1080p" | "4k")[];
}
```

## ModelVariant (for variant groups in the registry)

```typescript
export interface ModelVariant {
  id: ModelId;
  label: string;              // Short label for UI selector (e.g. "Flash", "Pro")
  costPerImage: number;
  costPerSecond?: number;
  avgGenerationTime: number;   // seconds
  description: string;
  capabilities?: Partial<ModelCapabilities>; // overrides for this variant
}
```
