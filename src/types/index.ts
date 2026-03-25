// ============================================================
// Core types for the Media Generation Studio
// ============================================================

// -- Media Type --

export type MediaType = "image" | "video";

// -- Models & Providers --

export type ModelId =
  | "imagen-4"
  | "imagen-4-ultra"
  | "imagen-4-fast"
  | "imagen-flash"
  | "imagen-flash-lite"
  | "grok-imagine"
  | "grok-imagine-pro"
  | "flux-1.1-pro"
  | "flux-dev"
  | "flux-kontext-pro"
  | "flux-2-klein"
  | "ideogram-3"
  | "recraft-v3"
  | "recraft-20b"
  | "recraft-v4"
  | "recraft-v4-pro"
  | "veo-3"
  | "veo-3.1"
  | "veo-3-fast"
  | "runway-gen4-turbo"
  | "runway-gen4.5"
  | "kling-2.1"
  | "kling-2.1-pro"
  | "hailuo-2.3"
  | "hailuo-2.3-fast"
  | "ray-2"
  | "ray-flash-2";

export type ProviderName =
  | "google"
  | "xai"
  | "bfl"
  | "ideogram"
  | "recraft"
  | "runway"
  | "fal"
  | "minimax"
  | "luma";

export interface ModelCapabilities {
  aspectRatios: string[];
  maxResolution?: { width: number; height: number };
  styles?: string[];
  supportsNegativePrompt: boolean;
  supportsBatchGeneration: boolean;
  maxBatchSize: number;
  // Shared optional capabilities
  supportsSeed?: boolean;
  supportsOutputFormat?: boolean;
  supportsResolution?: boolean;
  resolutionOptions?: string[]; // e.g. ["512", "1K", "2K", "4K"] or ["720p", "1080p", "4k"]
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
  maxDuration?: number; // seconds
  supportedDurations?: number[]; // e.g. [5, 8, 10]
  supportsAudio?: boolean;
  supportsImageToVideo?: boolean;
  supportsCameraControl?: boolean;
  cameraMotions?: string[]; // available camera motion options
  resolutions?: ("540p" | "720p" | "1080p" | "4k")[];
}

export interface ModelVariant {
  id: ModelId;
  label: string; // Short label for the segmented control (e.g. "Imagen 4", "Flash", "Lite")
  costPerImage: number;
  costPerSecond?: number;
  avgGenerationTime: number;
  description: string;
  capabilities?: Partial<ModelCapabilities>; // Variant-specific overrides
}

export interface ModelInfo {
  id: ModelId;
  name: string;
  provider: ProviderName;
  mediaType: MediaType;
  description: string;
  capabilities: ModelCapabilities;
  costPerImage: number; // USD estimate (for images)
  costPerSecond?: number; // USD estimate (for video)
  avgGenerationTime: number; // seconds
  variants?: ModelVariant[]; // If present, card shows a variant selector
}

// -- Generation --

export interface GenerationParams {
  prompt: string;
  enhancedPrompt?: string;
  model: ModelId;
  aspectRatio?: string;
  style?: string;
  negativePrompt?: string;
  quality?: "standard" | "high";
  numImages?: number;
  // Shared advanced params
  seed?: number;
  outputFormat?: "jpeg" | "png";
  resolution?: string; // "720p", "1080p", "4k", "1K", "2K", etc.
  guidance?: number; // prompt adherence strength
  steps?: number; // inference steps
  cfgScale?: number; // classifier-free guidance scale
  renderingSpeed?: "TURBO" | "DEFAULT" | "QUALITY";
  personGeneration?: "dont_allow" | "allow_adult" | "allow_all";
  watermark?: boolean;
  promptEnhance?: boolean; // provider-side prompt enhancement
  promptOptimizer?: boolean; // Hailuo prompt optimizer
  loop?: boolean; // Luma loop mode
  // Video params
  duration?: number; // seconds
  imageInput?: string; // R2 URL for image-to-video
  audioEnabled?: boolean;
  cameraControl?: string; // for Ray 2 / Luma concepts
  // LoRA params
  loras?: Array<{ path: string; scale: number; triggerWords?: string[] }>;
  nsfwEnabled?: boolean;
  [key: string]: unknown; // model-specific params
}

export type GenerationStatus = "pending" | "processing" | "completed" | "failed";

export interface GenerationResult {
  status: GenerationStatus;
  // Image result
  imageUrl?: string;
  imageBuffer?: Buffer;
  width?: number;
  height?: number;
  // Video result
  videoUrl?: string; // provider-hosted URL to download
  videoBuffer?: Buffer;
  posterUrl?: string; // thumbnail frame from provider
  duration?: number; // actual duration in seconds
  hasAudio?: boolean;
  // Async job tracking
  jobId?: string;
  // Common
  error?: string;
  durationMs?: number;
}

// -- Provider Interface --

export interface GenerationProvider {
  id: ModelId;
  name: string;
  provider: ProviderName;
  mediaType: MediaType;
  capabilities: ModelCapabilities;
  costPerImage: number; // 0 for video-only providers
  costPerSecond?: number; // for video providers
  generate(params: GenerationParams): Promise<GenerationResult>;
  getStatus?(jobId: string): Promise<GenerationResult>;
}

// -- Assets --

export interface Asset {
  id: string;
  userId: string;
  model: ModelId;
  provider: ProviderName;
  mediaType: MediaType;
  prompt: string;
  enhancedPrompt?: string;
  parameters: Record<string, unknown>;
  r2Key: string;
  r2Url: string;
  thumbnailR2Key?: string;
  width: number;
  height: number;
  fileSize: number;
  costEstimate: number;
  duration?: number;
  hasAudio?: boolean;
  createdAt: Date;
  brands?: Brand[];
  tags?: string[];
  user?: { name: string; email: string; image?: string };
}

export interface Brand {
  id: string;
  name: string;
  color: string;
  createdBy: string;
  createdAt: Date;
}

// -- Prompt Improver --

export type PromptImproverMode = "template" | "llm";

export interface PromptModifier {
  category: string;
  label: string;
  value: string;
}

export interface PromptTemplate {
  style?: string;
  lighting?: string;
  composition?: string;
  mood?: string;
  quality?: string;
}

// -- Usage & Rate Limiting --

export interface UsageStats {
  userId: string;
  generationsToday: number;
  dailyLimit: number;
  totalGenerations: number;
  totalCost: number;
  byModel: Record<ModelId, { count: number; cost: number }>;
}

// -- API Responses --

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// -- Gallery Filters --

export interface GalleryFilters {
  brandId?: string;
  model?: ModelId;
  mediaType?: MediaType;
  tag?: string;
  creatorId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

// -- Civitai / LoRA --

export interface CivitaiModel {
  id: number;
  name: string;
  description: string | null;
  nsfw: boolean;
  tags: string[];
  creator: { username: string; image: string | null };
  stats: {
    downloadCount: number;
    thumbsUpCount: number;
    thumbsDownCount?: number;
    commentCount?: number;
    tippedAmountCount?: number;
  };
  allowCommercialUse?: string;
  supportsGeneration?: boolean;
  modelVersions: CivitaiModelVersion[];
}

export interface CivitaiModelVersion {
  id: number;
  name: string;
  baseModel: string;
  trainedWords: string[];
  publishedAt?: string;
  stats?: { downloadCount: number; thumbsUpCount: number; thumbsDownCount?: number };
  files: Array<{
    id: number;
    sizeKB: number;
    downloadUrl: string;
    metadata: { format: string };
  }>;
  images: Array<{
    url: string;
    width: number;
    height: number;
    nsfwLevel?: number;
  }>;
}

export interface SelectedLora {
  id?: string;
  civitaiModelId: number;
  civitaiVersionId: number;
  name: string;
  downloadUrl: string;
  scale: number;
  triggerWords: string[];
  previewImageUrl?: string;
}
