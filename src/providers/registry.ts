import type { ModelId, ModelInfo, ModelVariant, GenerationProvider, MediaType } from "@/types";
import { imagenProvider, imagenFlashProvider, imagenFlashLiteProvider, imagenUltraProvider, imagenFastProvider } from "./imagen";
import { grokProvider, grokProProvider } from "./grok";
import { fluxProvider, fluxDevProvider, fluxKontextProvider, fluxKleinProvider } from "./flux";
import { ideogramProvider } from "./ideogram";
import { recraftProvider, recraft20bProvider, recraftV4Provider, recraftV4ProProvider } from "./recraft";
import { veoProvider, veo31Provider, veoFastProvider } from "./veo";
import { runwayProvider, runwayGen45Provider } from "./runway";
import { klingProvider, klingProProvider } from "./kling";
import { hailuoProvider, hailuoFastProvider } from "./hailuo";
import { lumaProvider, lumaFlashProvider } from "./luma";

// All registered providers (variant-only entries are hidden from top-level cards but reachable by ID)
const allProviders: GenerationProvider[] = [
  // Image providers
  imagenProvider,
  imagenFlashProvider,
  imagenFlashLiteProvider,
  imagenUltraProvider,
  imagenFastProvider,
  grokProvider,
  grokProProvider,
  fluxProvider,
  fluxDevProvider,
  fluxKontextProvider,
  fluxKleinProvider,
  ideogramProvider,
  recraftProvider,
  recraft20bProvider,
  recraftV4Provider,
  recraftV4ProProvider,
  // Video providers
  veoProvider,
  veo31Provider,
  veoFastProvider,
  runwayProvider,
  runwayGen45Provider,
  klingProvider,
  klingProProvider,
  hailuoProvider,
  hailuoFastProvider,
  lumaProvider,
  lumaFlashProvider,
];

// Providers that should NOT get their own card — they appear as variants
const VARIANT_ONLY_IDS: Set<ModelId> = new Set([
  "imagen-flash",
  "imagen-flash-lite",
  "imagen-4-ultra",
  "imagen-4-fast",
  "grok-imagine-pro",
  "flux-dev",
  "flux-kontext-pro",
  "flux-2-klein",
  "recraft-20b",
  "recraft-v4",
  "recraft-v4-pro",
  "veo-3.1",
  "veo-3-fast",
  "runway-gen4.5",
  "kling-2.1-pro",
  "hailuo-2.3-fast",
  "ray-flash-2",
]);

// Variant groups: primary model ID → variant metadata
const VARIANT_GROUPS: Partial<Record<ModelId, ModelVariant[]>> = {
  "imagen-4": [
    {
      id: "imagen-4",
      label: "Imagen 4",
      costPerImage: 0.04,
      avgGenerationTime: 8,
      description: "Google's most capable image model. Photorealistic, high quality.",
    },
    {
      id: "imagen-flash",
      label: "Flash",
      costPerImage: 0.002,
      avgGenerationTime: 3,
      description: "Fast & cheap Gemini image generation. Great for testing & iteration.",
    },
    {
      id: "imagen-flash-lite",
      label: "Lite",
      costPerImage: 0.001,
      avgGenerationTime: 2,
      description: "Cheapest Gemini image model. Best for rapid prototyping.",
    },
    {
      id: "imagen-4-ultra",
      label: "Ultra",
      costPerImage: 0.08,
      avgGenerationTime: 12,
      description: "Highest quality. 2K resolution output.",
    },
    {
      id: "imagen-4-fast",
      label: "Fast",
      costPerImage: 0.02,
      avgGenerationTime: 4,
      description: "Low-latency generation for rapid iteration.",
    },
  ],
  "grok-imagine": [
    {
      id: "grok-imagine",
      label: "Imagine",
      costPerImage: 0.02,
      avgGenerationTime: 5,
      description: "xAI's fast image generation with creative styles.",
    },
    {
      id: "grok-imagine-pro",
      label: "Pro",
      costPerImage: 0.07,
      avgGenerationTime: 8,
      description: "xAI's highest quality image model. Up to 2K resolution.",
    },
  ],
  "flux-1.1-pro": [
    {
      id: "flux-1.1-pro",
      label: "Pro 1.1",
      costPerImage: 0.04,
      avgGenerationTime: 6,
      description: "Black Forest Labs' high-quality, fast image generation.",
    },
    {
      id: "flux-dev",
      label: "Dev",
      costPerImage: 0.025,
      avgGenerationTime: 8,
      description: "Cheaper Flux model. Good quality at lower cost for iteration.",
    },
    {
      id: "flux-kontext-pro",
      label: "Kontext",
      costPerImage: 0.04,
      avgGenerationTime: 8,
      description: "Image editing with character consistency and text rendering.",
    },
    {
      id: "flux-2-klein",
      label: "Klein",
      costPerImage: 0.015,
      avgGenerationTime: 2,
      description: "Budget model. Sub-second inference, great for drafts.",
    },
  ],
  "recraft-v3": [
    {
      id: "recraft-v3",
      label: "V3",
      costPerImage: 0.04,
      avgGenerationTime: 8,
      description: "Design-focused generation with vector and brand-safe styles.",
    },
    {
      id: "recraft-20b",
      label: "20B",
      costPerImage: 0.02,
      avgGenerationTime: 5,
      description: "Lighter Recraft model. Nearly half the cost, still solid quality.",
    },
    {
      id: "recraft-v4",
      label: "V4",
      costPerImage: 0.04,
      avgGenerationTime: 8,
      description: "Latest model. 10K char prompts, improved quality.",
    },
    {
      id: "recraft-v4-pro",
      label: "V4 Pro",
      costPerImage: 0.08,
      avgGenerationTime: 10,
      description: "Premium. 4MP print-ready output.",
    },
  ],
  "veo-3": [
    {
      id: "veo-3",
      label: "Veo 3",
      costPerImage: 0,
      costPerSecond: 0.15,
      avgGenerationTime: 120,
      description: "Google's video model with native audio.",
    },
    {
      id: "veo-3.1",
      label: "3.1",
      costPerImage: 0,
      costPerSecond: 0.15,
      avgGenerationTime: 120,
      description: "4K support, video extension up to 148s, reference images.",
    },
    {
      id: "veo-3-fast",
      label: "Fast",
      costPerImage: 0,
      costPerSecond: 0.08,
      avgGenerationTime: 60,
      description: "Faster variant. Same quality, lower latency.",
    },
  ],
  "runway-gen4-turbo": [
    {
      id: "runway-gen4-turbo",
      label: "Turbo",
      costPerImage: 0,
      costPerSecond: 0.05,
      avgGenerationTime: 30,
      description: "Image-to-video specialist. Fast generation.",
    },
    {
      id: "runway-gen4.5",
      label: "4.5",
      costPerImage: 0,
      costPerSecond: 0.10,
      avgGenerationTime: 45,
      description: "Flagship. Text + image to video.",
    },
  ],
  "kling-2.1": [
    {
      id: "kling-2.1",
      label: "Standard",
      costPerImage: 0,
      costPerSecond: 0.075,
      avgGenerationTime: 90,
      description: "Top-tier motion quality via fal.ai.",
    },
    {
      id: "kling-2.1-pro",
      label: "Pro",
      costPerImage: 0,
      costPerSecond: 0.15,
      avgGenerationTime: 90,
      description: "Higher quality. Motion brush and special effects.",
    },
  ],
  "hailuo-2.3": [
    {
      id: "hailuo-2.3",
      label: "Standard",
      costPerImage: 0,
      costPerSecond: 0.045,
      avgGenerationTime: 60,
      description: "Best cost/quality ratio. Native audio.",
    },
    {
      id: "hailuo-2.3-fast",
      label: "Fast",
      costPerImage: 0,
      costPerSecond: 0.03,
      avgGenerationTime: 30,
      description: "Faster and cheaper. Good for iteration.",
    },
  ],
  "ray-2": [
    {
      id: "ray-2",
      label: "Ray 2",
      costPerImage: 0,
      costPerSecond: 0.07,
      avgGenerationTime: 60,
      description: "Camera controls. Up to 60s extended clips.",
    },
    {
      id: "ray-flash-2",
      label: "Flash",
      costPerImage: 0,
      costPerSecond: 0.025,
      avgGenerationTime: 20,
      description: "3x faster and cheaper. Up to 15s duration.",
    },
  ],
};

/**
 * Check if the API key for a provider is configured.
 */
function hasApiKey(provider: GenerationProvider): boolean {
  switch (provider.provider) {
    case "google":
      return !!process.env.GEMINI_API_KEY;
    case "xai":
      return !!process.env.XAI_API_KEY;
    case "bfl":
      return !!process.env.BFL_API_KEY;
    case "ideogram":
      return !!process.env.IDEOGRAM_API_KEY;
    case "recraft":
      return !!process.env.RECRAFT_API_KEY;
    case "runway":
      return !!process.env.RUNWAY_API_KEY;
    case "fal":
      return !!process.env.FAL_KEY;
    case "minimax":
      return !!process.env.MINIMAX_API_KEY;
    case "luma":
      return !!process.env.LUMA_API_KEY;
    default:
      return false;
  }
}

/**
 * Get all providers that have API keys configured.
 * Variant-only models (Flash, Lite) are excluded from the card list
 * but remain accessible via getProvider().
 */
export function getAvailableProviders(mediaType?: MediaType): GenerationProvider[] {
  let providers = allProviders.filter(
    (p) => hasApiKey(p) && !VARIANT_ONLY_IDS.has(p.id),
  );
  if (mediaType) {
    providers = providers.filter((p) => p.mediaType === mediaType);
  }
  return providers;
}

/**
 * Get a specific provider by model ID.
 */
export function getProvider(modelId: ModelId): GenerationProvider | undefined {
  const provider = allProviders.find((p) => p.id === modelId);
  if (!provider) return undefined;

  // Verify API key is available
  return hasApiKey(provider) ? provider : undefined;
}

/**
 * Get model info for all available models.
 * Models with variants include the full variant list so the UI can
 * render a segmented selector inside the card.
 */
export function getAvailableModels(mediaType?: MediaType): ModelInfo[] {
  return getAvailableProviders(mediaType).map((p) => ({
    id: p.id,
    name: p.name,
    provider: p.provider,
    mediaType: p.mediaType,
    description: getModelDescription(p.id),
    capabilities: p.capabilities,
    costPerImage: p.costPerImage,
    costPerSecond: p.costPerSecond,
    avgGenerationTime: getAvgGenTime(p.id),
    variants: VARIANT_GROUPS[p.id],
  }));
}

function getModelDescription(id: ModelId): string {
  const descriptions: Record<ModelId, string> = {
    "imagen-4": "Google's most capable image model. Photorealistic, high quality.",
    "imagen-4-ultra": "Highest quality. 2K resolution output.",
    "imagen-4-fast": "Low-latency generation for rapid iteration.",
    "imagen-flash": "Fast & cheap Gemini image generation. Great for testing & iteration.",
    "imagen-flash-lite": "Cheapest Gemini image model. Best for rapid prototyping.",
    "grok-imagine": "xAI's fast image generation with creative styles.",
    "grok-imagine-pro": "xAI's highest quality image model. Up to 2K resolution.",
    "flux-1.1-pro": "Black Forest Labs' high-quality, fast image generation.",
    "flux-dev": "Cheaper Flux model. Good quality at lower cost for iteration.",
    "flux-kontext-pro": "Image editing with character consistency and text rendering.",
    "flux-2-klein": "Budget model. Sub-second inference, great for drafts.",
    "ideogram-3": "Best-in-class text rendering in images.",
    "recraft-v3": "Design-focused generation with vector and brand-safe styles.",
    "recraft-20b": "Lighter Recraft model. Nearly half the cost, still solid quality.",
    "recraft-v4": "Latest model. 10K char prompts, improved quality.",
    "recraft-v4-pro": "Premium. 4MP print-ready output.",
    "veo-3": "Google's video model with native audio. Up to 8s clips.",
    "veo-3.1": "4K support, video extension up to 148s, reference images.",
    "veo-3-fast": "Faster variant. Same quality, lower latency.",
    "runway-gen4-turbo": "Runway's cinematic video model. Mature API, fast generation.",
    "runway-gen4.5": "Flagship. Text + image to video.",
    "kling-2.1": "Top-tier motion quality and physics via fal.ai.",
    "kling-2.1-pro": "Higher quality. Motion brush and special effects.",
    "hailuo-2.3": "Best cost/quality ratio. Native audio included.",
    "hailuo-2.3-fast": "Faster and cheaper. Good for iteration.",
    "ray-2": "Luma's model with camera controls. Up to 60s extended clips.",
    "ray-flash-2": "3x faster and cheaper. Up to 15s duration.",
  };
  return descriptions[id];
}

function getAvgGenTime(id: ModelId): number {
  const times: Record<ModelId, number> = {
    "imagen-4": 8,
    "imagen-4-ultra": 12,
    "imagen-4-fast": 4,
    "imagen-flash": 3,
    "imagen-flash-lite": 2,
    "grok-imagine": 5,
    "grok-imagine-pro": 8,
    "flux-1.1-pro": 6,
    "flux-dev": 8,
    "flux-kontext-pro": 8,
    "flux-2-klein": 2,
    "ideogram-3": 10,
    "recraft-v3": 8,
    "recraft-20b": 5,
    "recraft-v4": 8,
    "recraft-v4-pro": 10,
    "veo-3": 120,
    "veo-3.1": 120,
    "veo-3-fast": 60,
    "runway-gen4-turbo": 30,
    "runway-gen4.5": 45,
    "kling-2.1": 90,
    "kling-2.1-pro": 90,
    "hailuo-2.3": 60,
    "hailuo-2.3-fast": 30,
    "ray-2": 60,
    "ray-flash-2": 20,
  };
  return times[id];
}
