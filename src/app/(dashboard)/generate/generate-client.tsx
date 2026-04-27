"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import {
  Wand2,
  Sparkles,
  Loader2,
  Download,
  RotateCcw,
  Clock,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Zap,
  Image as ImageIcon,
  Video,
  Volume2,
  VolumeX,
  Camera,
  Upload,
  X,
  Maximize2,
  Eraser,
  Pencil,
  FileType,
  Tag,
  Check,
  Info,
  Copy,
  FlaskConical,
  ImagePlus,
} from "lucide-react";
import { toast } from "sonner";
import { BrandSelector } from "@/components/brand-selector";
import { BrandMark } from "@/components/brand-mark";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import type { ModelInfo, ModelVariant, PromptTemplate, MediaType, SelectedLora, Brew } from "@/types";
import { normalizeImageInputs } from "@/lib/normalize-image-inputs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import type { promptModifiers as PromptModifiersType } from "@/providers/prompt-improver";
import { LoraBrowser } from "./lora-browser";

interface GenerateClientProps {
  imageModels: ModelInfo[];
  videoModels: ModelInfo[];
  modifiers: typeof PromptModifiersType;
}

interface GeneratedAsset {
  id: string;
  url: string;
  width?: number;
  height?: number;
  model: string;
  prompt: string;
  costEstimate: number;
  mediaType: MediaType;
  duration?: number;
}

interface VideoJob {
  generationId: string;
  status: "processing" | "completed" | "failed";
  elapsed?: number;
  error?: string;
  asset?: GeneratedAsset;
}

interface BrandOption {
  id: string;
  name: string;
  color: string;
  slug: string | null;
  isPersonal: boolean;
  ownerId: string | null;
  videoEnabled: boolean;
  logoUrl?: string | null;
  ownerImage?: string | null;
}

/** Logo path per model card (variants share the parent's logo) */
const MODEL_LOGOS: Record<string, string> = {
  "imagen-4": "/logos/gemini.png",
  "grok-imagine": "/logos/xai.png",
  "flux-1.1-pro": "/logos/bfl.png",
  "ideogram-3": "/logos/ideogram.png",
  "recraft-v3": "/logos/recraft.png",
  "gpt-image-1.5": "/logos/openai.png",
};

/** Fallback emoji for models without a logo (e.g. video providers) */
const MODEL_ICONS: Record<string, string> = {
  "veo-3": "\u{1F3AC}",
  "runway-gen4-turbo": "\u{1F3AC}",
  "kling-2.1": "\u{1F3AC}",
  "hailuo-2.3": "\u{1F3AC}",
  "ray-2": "\u{1F3AC}",
  "wan-2.1": "\u{1F3AC}",
};

const PROMPT_MAX_LENGTH = 2000;
const VIDEO_POLL_INTERVAL = 3000;

function AspectRatioPreview({
  ratio,
  selected,
}: {
  ratio: string;
  selected: boolean;
}) {
  const [w, h] = ratio.split(":").map(Number);
  const max = Math.max(w, h);
  const nw = w / max;
  const nh = h / max;
  const boxW = Math.round(nw * 20);
  const boxH = Math.round(nh * 20);

  return (
    <div
      className={`mx-auto mb-1 rounded-[3px] border transition-colors ${
        selected
          ? "border-primary bg-primary/20"
          : "border-muted-foreground/30 bg-muted-foreground/5"
      }`}
      style={{ width: `${boxW}px`, height: `${boxH}px` }}
    />
  );
}

const PARAM_TOOLTIPS: Record<string, string> = {
  "Aspect Ratio": "The width-to-height ratio of the generated image.",
  "Negative Prompt": "Describe what you want to exclude — helps avoid unwanted elements in the output.",
  "Resolution": "Output image resolution. Higher values produce more detail but take longer.",
  "Output Format": "PNG for lossless quality, JPEG for smaller file sizes.",
  "Seed": "A number for reproducibility. Same seed + same prompt = same result.",
  "Guidance": "How closely the model follows your prompt. Higher values = more literal interpretation.",
  "Steps": "Number of diffusion steps. More steps = finer detail but slower generation.",
  "CFG Scale": "Classifier-free guidance scale. Controls how strongly the model adheres to the prompt.",
  "Rendering Speed": "Trade-off between speed and quality. Turbo is fastest, Quality is most detailed.",
  "Style": "Apply a predefined artistic style to the generated image.",
  "Person Generation": "Controls whether people can appear in generated images. Required by some providers for safety.",
  "Watermark": "Adds a provider watermark to the output. Disabling may affect usage terms.",
  "Provider Prompt Enhance": "Lets the AI provider automatically rewrite your prompt for better results.",
  "Prompt Optimizer": "Optimizes your prompt on the provider side before generation.",
  "Loop Video": "Makes the video seamlessly loop back to its first frame.",
  "Duration": "Length of the generated video in seconds.",
  "Generate Audio": "Generate a synchronized audio track along with the video.",
  "Camera Motion": "Apply a predefined camera movement to the generated video.",
};

function ParamLabel({ children, tooltip }: { children: string; tooltip?: string }) {
  const tip = tooltip ?? PARAM_TOOLTIPS[children];
  if (!tip) {
    return <Label className="text-xs text-muted-foreground">{children}</Label>;
  }
  return (
    <Label className="text-xs text-muted-foreground inline-flex items-center gap-1">
      {children}
      <Tooltip>
        <TooltipTrigger
          className="text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-help"
          onClick={(e) => e.preventDefault()}
        >
          <Info className="h-3 w-3" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px]">
          {tip}
        </TooltipContent>
      </Tooltip>
    </Label>
  );
}

export function GenerateClient({
  imageModels,
  videoModels,
  modifiers,
}: GenerateClientProps) {
  // Media type
  const [mediaType, setMediaType] = useState<MediaType>(
    imageModels.length > 0 ? "image" : "video"
  );
  const models = mediaType === "image" ? imageModels : videoModels;

  // Shared state
  const [prompt, setPrompt] = useState("");
  const [enhancedPrompt, setEnhancedPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState(models[0]?.id ?? "");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [style, setStyle] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [generatedAsset, setGeneratedAsset] = useState<GeneratedAsset | null>(null);
  const [enhanceMode, setEnhanceMode] = useState<"template" | "llm">("template");
  const [template, setTemplate] = useState<PromptTemplate>({});
  const [showEnhancer, setShowEnhancer] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(true);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Brands (FR-007 / FR-027)
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [assetBrands, setAssetBrands] = useState<string[]>([]);
  // Brand under which the next generation will be created (US2 / FR-004).
  const [activeBrandId, setActiveBrandId] = useState<string | null>(null);
  // Workspace-level video capability for the current user (FR-034).
  const [canGenerateVideoForUser, setCanGenerateVideoForUser] = useState<boolean>(true);
  // Active brand's kit details (US7) — fetched from /api/brands/[id] only when
  // the active brand changes. Null until loaded; null is also valid for an
  // empty kit (no prefix/suffix/banned terms).
  const [activeBrandKit, setActiveBrandKit] = useState<{
    promptPrefix: string | null;
    promptSuffix: string | null;
    bannedTerms: string[];
    defaultLoraId: string | null;
    defaultLoraIds: string[];
    anchorReferenceIds: string[];
  } | null>(null);
  // FR-015 override toggle. Resets when active brand changes.
  const [brandKitOverride, setBrandKitOverride] = useState<boolean>(false);

  useEffect(() => {
    fetch("/api/brands")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setBrands(data);
      })
      .catch(() => {});
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.canGenerateVideo === "boolean") {
          setCanGenerateVideoForUser(data.canGenerateVideo);
        }
      })
      .catch(() => {});
  }, []);

  // Pull the active brand's kit when it changes. Personal brands and the
  // null state are no-ops — there's nothing to inject.
  useEffect(() => {
    setBrandKitOverride(false);
    if (!activeBrandId || activeBrandId === "personal") {
      setActiveBrandKit(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/brands/${activeBrandId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setActiveBrandKit({
          promptPrefix: data.promptPrefix ?? null,
          promptSuffix: data.promptSuffix ?? null,
          bannedTerms: Array.isArray(data.bannedTerms) ? data.bannedTerms : [],
          defaultLoraId: data.defaultLoraId ?? null,
          defaultLoraIds: Array.isArray(data.defaultLoraIds) ? data.defaultLoraIds : [],
          anchorReferenceIds: Array.isArray(data.anchorReferenceIds) ? data.anchorReferenceIds : [],
        });
      })
      .catch(() => setActiveBrandKit(null));
    return () => {
      cancelled = true;
    };
  }, [activeBrandId]);

  const activeBrand = brands.find((b) => b.id === activeBrandId) ?? null;
  // The kit is only "active" when the brand is non-Personal AND has at least
  // one injectable field. Personal brands skip the panel since their kit is
  // empty by definition (FR-006).
  const hasActiveKit =
    !!activeBrand &&
    !activeBrand.isPersonal &&
    !!activeBrandKit &&
    (!!activeBrandKit.promptPrefix?.trim() ||
      !!activeBrandKit.promptSuffix?.trim() ||
      activeBrandKit.bannedTerms.length > 0 ||
      activeBrandKit.anchorReferenceIds.length > 0 ||
      !!activeBrandKit.defaultLoraId ||
      activeBrandKit.defaultLoraIds.length > 0);
  const videoTabDisabled =
    !canGenerateVideoForUser ||
    (!!activeBrand && !activeBrand.isPersonal && !activeBrand.videoEnabled);
  const videoTabReason = !canGenerateVideoForUser
    ? "Your studio admin hasn't granted video access."
    : activeBrand && !activeBrand.isPersonal && !activeBrand.videoEnabled
    ? `Video generation is disabled for ${activeBrand.name}.`
    : null;

  // Image input state (multi-reference, up to 4)
  const MAX_REFERENCE_IMAGES = 4;
  const [imageInputs, setImageInputs] = useState<string[]>([]);
  const [imageInputPreviews, setImageInputPreviews] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canAddMoreImages = imageInputs.length < MAX_REFERENCE_IMAGES;

  // Hydrate from query params (e.g. from gallery "Animate" or references "Use")
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const imgInput = params.get("imageInput");
    if (imgInput) {
      setImageInputs([imgInput]);
      setImageInputPreviews([imgInput]);
    }
    const mediaParam = params.get("mediaType");
    if (mediaParam === "video") setMediaType("video");
    const promptParam = params.get("prompt");
    if (promptParam) setPrompt(promptParam);
  }, []);

  // Reference picker state
  const [showRefPicker, setShowRefPicker] = useState(false);
  const [refPickerItems, setRefPickerItems] = useState<Array<{ id: string; url: string; thumbnailUrl: string; fileName: string | null }>>([]);
  const [refPickerLoading, setRefPickerLoading] = useState(false);
  const [refPickerCursor, setRefPickerCursor] = useState<string | null>(null);

  function handleRefPickerOpen() {
    setShowRefPicker(true);
    if (refPickerItems.length === 0) {
      setRefPickerLoading(true);
      fetch("/api/references?limit=20")
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data: { references: typeof refPickerItems; nextCursor: string | null }) => {
          setRefPickerItems(data.references);
          setRefPickerCursor(data.nextCursor);
        })
        .catch(() => {})
        .finally(() => setRefPickerLoading(false));
    }
  }

  function handleRefPickerLoadMore() {
    if (!refPickerCursor || refPickerLoading) return;
    setRefPickerLoading(true);
    fetch(`/api/references?limit=20&cursor=${refPickerCursor}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { references: typeof refPickerItems; nextCursor: string | null }) => {
        setRefPickerItems((prev) => [...prev, ...data.references]);
        setRefPickerCursor(data.nextCursor);
      })
      .catch(() => {})
      .finally(() => setRefPickerLoading(false));
  }

  function handleRefPickerSelect(ref: { url: string }) {
    if (imageInputs.length >= MAX_REFERENCE_IMAGES) {
      toast.error(`Maximum ${MAX_REFERENCE_IMAGES} reference images`);
      return;
    }
    if (imageInputs.includes(ref.url)) {
      toast.error("Image already added");
      return;
    }
    setImageInputs((prev) => [...prev, ref.url]);
    setImageInputPreviews((prev) => [...prev, ref.url]);
    setShowRefPicker(false);
    toast.success("Reference image added");
  }

  // Gallery picker state (for picking generated assets as references)
  const [galleryPickerItems, setGalleryPickerItems] = useState<Array<{ id: string; url: string; thumbnailUrl: string; prompt: string }>>([]);
  const [galleryPickerLoading, setGalleryPickerLoading] = useState(false);
  const [galleryPickerCursor, setGalleryPickerCursor] = useState<string | null>(null);
  const [galleryPickerLoaded, setGalleryPickerLoaded] = useState(false);

  function handleGalleryPickerLoad() {
    if (galleryPickerLoaded) return;
    setGalleryPickerLoading(true);
    fetch("/api/assets?mediaType=image&limit=20")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { assets: Array<{ id: string; url: string; thumbnailUrl: string; prompt: string }>; nextCursor: string | null }) => {
        setGalleryPickerItems(data.assets);
        setGalleryPickerCursor(data.nextCursor);
        setGalleryPickerLoaded(true);
      })
      .catch(() => {})
      .finally(() => setGalleryPickerLoading(false));
  }

  function handleGalleryPickerLoadMore() {
    if (!galleryPickerCursor || galleryPickerLoading) return;
    setGalleryPickerLoading(true);
    fetch(`/api/assets?mediaType=image&limit=20&cursor=${galleryPickerCursor}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { assets: Array<{ id: string; url: string; thumbnailUrl: string; prompt: string }>; nextCursor: string | null }) => {
        setGalleryPickerItems((prev) => [...prev, ...data.assets]);
        setGalleryPickerCursor(data.nextCursor);
      })
      .catch(() => {})
      .finally(() => setGalleryPickerLoading(false));
  }

  // Advanced params state
  const [seed, setSeed] = useState<string>("");
  const [outputFormat, setOutputFormat] = useState<string>("");
  const [modelResolution, setModelResolution] = useState<string>("");
  const [guidance, setGuidance] = useState<string>("");
  const [steps, setSteps] = useState<string>("");
  const [cfgScale, setCfgScale] = useState<string>("");
  const [renderingSpeed, setRenderingSpeed] = useState<string>("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [personGeneration, setPersonGeneration] = useState<string>("");
  const [watermark, setWatermark] = useState(true);
  const [promptEnhance, setPromptEnhance] = useState(true);
  const [promptOptimizer, setPromptOptimizer] = useState(true);
  const [loop, setLoop] = useState(false);

  // Video-specific state
  const [duration, setDuration] = useState(5);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [cameraControl, setCameraControl] = useState("");
  const [videoJob, setVideoJob] = useState<VideoJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // LoRA state
  const [selectedLoras, setSelectedLoras] = useState<SelectedLora[]>([]);
  const [nsfwEnabled, setNsfwEnabled] = useState(false);

  // Brew state
  const [showSaveBrew, setShowSaveBrew] = useState(false);
  const [brewName, setBrewName] = useState("");
  const [brewDescription, setBrewDescription] = useState("");
  const [brewIncludePrompt, setBrewIncludePrompt] = useState(true);
  const [isSavingBrew, setIsSavingBrew] = useState(false);
  const [brewsPopoverOpen, setBrewsPopoverOpen] = useState(false);
  const [userBrews, setUserBrews] = useState<Brew[]>([]);
  const [isLoadingBrews, setIsLoadingBrews] = useState(false);

  // Resolve currentModel — selectedModel might be a variant ID, so check
  // both direct match and variant membership
  const currentModel = models.find(
    (m) =>
      m.id === selectedModel ||
      m.variants?.some((v) => v.id === selectedModel),
  );
  const activeVariant = currentModel?.variants?.find((v) => v.id === selectedModel);
  const activeModelLabel = activeVariant
    ? `${currentModel?.name} ${activeVariant.label}`
    : currentModel?.name ?? selectedModel;
  const activeModelLogo = currentModel ? MODEL_LOGOS[currentModel.id] : undefined;
  const isVideo = mediaType === "video";
  const isReady = prompt.trim().length > 0 && !isGenerating;
  const mode = generatedAsset && !isGenerating ? "result" : "input";

  // Switch models when media type changes
  useEffect(() => {
    const available = mediaType === "image" ? imageModels : videoModels;
    const isInAvailable = available.some(
      (m) =>
        m.id === selectedModel ||
        m.variants?.some((v) => v.id === selectedModel),
    );
    if (available.length > 0 && !isInAvailable) {
      setSelectedModel(available[0].variants?.[0]?.id ?? available[0].id);
    }
  }, [mediaType, imageModels, videoModels, selectedModel]);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Hydrate NSFW from localStorage after mount, then persist changes
  const nsfwHydrated = useRef(false);
  useEffect(() => {
    if (!nsfwHydrated.current) {
      nsfwHydrated.current = true;
      const stored = localStorage.getItem("cauldron-nsfw-loras");
      if (stored === "true") setNsfwEnabled(true);
      return;
    }
    localStorage.setItem("cauldron-nsfw-loras", String(nsfwEnabled));
  }, [nsfwEnabled]);

  // Clear LoRAs when switching to a model that doesn't support them
  useEffect(() => {
    if (!currentModel?.capabilities.supportsLora && selectedLoras.length > 0) {
      setSelectedLoras([]);
    }
  }, [currentModel, selectedLoras.length]);

  // Poll video generation status
  const pollVideoStatus = useCallback(
    async (generationId: string) => {
      try {
        const res = await fetch(`/api/generate/${generationId}/status`);
        const data = await res.json();

        if (data.status === "completed" && data.asset) {
          if (pollRef.current) clearInterval(pollRef.current);
          setVideoJob({
            generationId,
            status: "completed",
            asset: {
              id: data.asset.id,
              url: data.asset.url,
              model: data.asset.model,
              prompt: data.asset.prompt,
              costEstimate: data.asset.costEstimate,
              mediaType: "video",
              duration: data.asset.duration,
            },
          });
          setGeneratedAsset({
            id: data.asset.id,
            url: data.asset.url,
            model: data.asset.model,
            prompt: data.asset.prompt,
            costEstimate: data.asset.costEstimate,
            mediaType: "video",
            duration: data.asset.duration,
          });
          setIsGenerating(false);
          toast.success("Video generated!");
        } else if (data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setVideoJob({
            generationId,
            status: "failed",
            error: data.error,
          });
          setIsGenerating(false);
          toast.error(data.error ?? "Video generation failed");
        } else {
          setVideoJob((prev) => ({
            ...prev!,
            elapsed: data.elapsed,
          }));
        }
      } catch {
        // Network error — keep polling
      }
    },
    []
  );

  async function handleImageUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be under 10 MB");
      return;
    }
    if (imageInputs.length >= MAX_REFERENCE_IMAGES) {
      toast.error(`Maximum ${MAX_REFERENCE_IMAGES} reference images`);
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setImageInputs((prev) => [...prev, data.url]);
      setImageInputPreviews((prev) => [...prev, URL.createObjectURL(file)]);
      toast.success("Image uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function clearAllImageInputs() {
    setImageInputs([]);
    setImageInputPreviews([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeImageInput(index: number) {
    setImageInputs((prev) => prev.filter((_, i) => i !== index));
    setImageInputPreviews((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleEnhance() {
    if (!prompt.trim()) {
      toast.error("Enter a prompt first");
      return;
    }
    setIsEnhancing(true);
    try {
      const res = await fetch("/api/generate/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          mode: enhanceMode,
          model: selectedModel,
          template: enhanceMode === "template" ? template : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEnhancedPrompt(data.enhanced);
      toast.success("Prompt enhanced");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enhancement failed");
    } finally {
      setIsEnhancing(false);
    }
  }

  async function handleGenerate() {
    if (!prompt.trim()) {
      toast.error("Enter a prompt");
      return;
    }

    setIsGenerating(true);
    setGeneratedAsset(null);
    setVideoJob(null);
    setImageLoaded(false);
    setAssetBrands([]);

    try {
      const body: Record<string, unknown> = {
        prompt,
        enhancedPrompt: enhancedPrompt || undefined,
        model: selectedModel,
        aspectRatio,
        style: style || undefined,
        brandId: activeBrandId ?? "personal",
      };

      // FR-015 — only send the override flag when it's actually on AND there
      // was something to override. Saves the server an unnecessary kit lookup.
      if (brandKitOverride && hasActiveKit) {
        body.brandKitOverride = true;
      }

      if (imageInputs.length > 0) body.imageInput = imageInputs;

      // Advanced params (only send if set)
      if (seed) body.seed = parseInt(seed, 10);
      if (outputFormat) body.outputFormat = outputFormat;
      if (modelResolution) body.resolution = modelResolution;
      if (guidance) body.guidance = parseFloat(guidance);
      if (steps) body.steps = parseInt(steps, 10);
      if (cfgScale) body.cfgScale = parseFloat(cfgScale);
      if (renderingSpeed) body.renderingSpeed = renderingSpeed;
      if (negativePrompt) body.negativePrompt = negativePrompt;
      if (personGeneration) body.personGeneration = personGeneration;
      if (currentModel?.capabilities.supportsWatermarkToggle && !watermark) body.watermark = false;
      if (currentModel?.capabilities.supportsPromptEnhance && !promptEnhance) body.promptEnhance = false;
      if (currentModel?.capabilities.supportsPromptOptimizer && !promptOptimizer) body.promptOptimizer = false;
      if (loop) body.loop = true;

      if (isVideo) {
        body.duration = duration;
        body.audioEnabled = audioEnabled;
        if (cameraControl) body.cameraControl = cameraControl;
      }

      // LoRA params
      if (selectedLoras.length > 0) {
        body.loras = selectedLoras.map((l) => ({
          path: l.downloadUrl,
          scale: l.scale,
          triggerWords: l.triggerWords,
        }));
        body.nsfwEnabled = nsfwEnabled;
      }

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (isVideo) {
        // Start polling
        const genId = data.generationId;
        setVideoJob({
          generationId: genId,
          status: "processing",
          elapsed: 0,
        });

        pollRef.current = setInterval(() => {
          pollVideoStatus(genId);
        }, VIDEO_POLL_INTERVAL);
      } else {
        // Image: result is immediate
        setGeneratedAsset({ ...data.asset, mediaType: "image" });
        setIsGenerating(false);
        toast.success("Image generated!");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Generation failed");
      setIsGenerating(false);
    }
  }

  function handleBackToInput(clearPrompt: boolean) {
    setGeneratedAsset(null);
    setVideoJob(null);
    setImageLoaded(false);
    if (clearPrompt) {
      setPrompt("");
      setEnhancedPrompt("");
      setImageInputs([]);
      setImageInputPreviews([]);
      setAssetBrands([]);
    }
  }

  // Save current generation config as a brew
  async function handleSaveBrew() {
    if (!brewName.trim()) return;
    setIsSavingBrew(true);
    try {
      const params: Record<string, unknown> = {
        aspectRatio, style, negativePrompt, seed, outputFormat,
        resolution: modelResolution, guidance, steps, cfgScale,
        renderingSpeed, personGeneration, watermark, promptEnhance,
        promptOptimizer, loop, duration, audioEnabled, cameraControl,
        nsfwEnabled,
      };
      if (selectedLoras.length > 0) {
        params.loras = selectedLoras.map((l) => ({
          source: l.source,
          civitaiModelId: l.civitaiModelId,
          civitaiVersionId: l.civitaiVersionId,
          hfRepoId: l.hfRepoId,
          name: l.name,
          downloadUrl: l.downloadUrl,
          scale: l.scale,
          triggerWords: l.triggerWords,
          previewImageUrl: l.previewImageUrl,
        }));
      }

      const res = await fetch("/api/brews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: brewName.trim(),
          description: brewDescription.trim() || undefined,
          model: selectedModel,
          prompt: brewIncludePrompt ? prompt : undefined,
          enhancedPrompt: brewIncludePrompt ? enhancedPrompt : undefined,
          parameters: params,
          previewUrl: generatedAsset?.url,
          imageInput: imageInputs.length > 0 ? imageInputs : undefined,
        }),
      });

      if (!res.ok) throw new Error("Failed to save brew");
      toast.success("Brew saved!");
      setShowSaveBrew(false);
      setBrewName("");
      setBrewDescription("");
    } catch {
      toast.error("Failed to save brew");
    } finally {
      setIsSavingBrew(false);
    }
  }

  // Load a brew — populate all generation state
  async function handleLoadBrew(brew: Brew) {
    const params = (brew.parameters ?? {}) as Record<string, unknown>;

    // Switch model (and media type if needed)
    const brewModel = brew.model as string;
    setSelectedModel(brewModel as typeof selectedModel);
    const isBrewVideo = videoModels.some(
      (m) => m.id === brewModel || m.variants?.some((v) => v.id === brewModel)
    );
    if (isBrewVideo) setMediaType("video");
    else setMediaType("image");

    // Set prompt
    if (brew.prompt) setPrompt(brew.prompt);
    if (brew.enhancedPrompt) setEnhancedPrompt(brew.enhancedPrompt);

    // Set parameters
    if (params.aspectRatio) setAspectRatio(params.aspectRatio as string);
    if (params.style) setStyle(params.style as string);
    if (params.negativePrompt) setNegativePrompt(params.negativePrompt as string);
    if (params.seed) setSeed(String(params.seed));
    if (params.outputFormat) setOutputFormat(params.outputFormat as string);
    if (params.guidance) setGuidance(String(params.guidance));
    if (params.steps) setSteps(String(params.steps));
    if (params.cfgScale) setCfgScale(String(params.cfgScale));
    if (params.renderingSpeed) setRenderingSpeed(params.renderingSpeed as string);
    if (params.duration) setDuration(params.duration as number);
    if (params.audioEnabled !== undefined) setAudioEnabled(params.audioEnabled as boolean);
    if (params.nsfwEnabled) setNsfwEnabled(true);

    // Set LoRAs (default source to "civitai" for backward compat with old brews)
    const savedLoras = params.loras as SelectedLora[] | undefined;
    if (savedLoras && savedLoras.length > 0) {
      setSelectedLoras(savedLoras.map((l) => ({ ...l, source: l.source ?? "civitai" })));
    } else {
      setSelectedLoras([]);
    }

    // Restore reference images (handles both old string and new array format)
    const restoredImages = normalizeImageInputs(brew.imageInput);
    setImageInputs(restoredImages);
    setImageInputPreviews(restoredImages);

    // Increment usage count
    fetch(`/api/brews/${brew.id}/use`, { method: "POST" }).catch(() => {});

    setBrewsPopoverOpen(false);
    toast.success(`Loaded brew: ${brew.name}`);
  }

  // Auto-load brew from ?brew= query param
  const searchParams = useSearchParams();
  const brewAutoLoaded = useRef(false);
  useEffect(() => {
    const brewId = searchParams.get("brew");
    if (!brewId || brewAutoLoaded.current) return;
    brewAutoLoaded.current = true;

    fetch("/api/brews")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { brews: Brew[] }) => {
        const brew = data.brews.find((b) => b.id === brewId);
        if (brew) {
          handleLoadBrew(brew);
        }
      })
      .catch(() => {});
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch brews for popover (lazy — only when opened)
  function handleBrewsPopoverOpen(open: boolean) {
    setBrewsPopoverOpen(open);
    if (open && userBrews.length === 0 && !isLoadingBrews) {
      setIsLoadingBrews(true);
      fetch("/api/brews")
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data: { brews: Brew[] }) => setUserBrews(data.brews ?? []))
        .catch(() => {})
        .finally(() => setIsLoadingBrews(false));
    }
  }

  const costDisplay = isVideo
    ? `$${((currentModel?.costPerSecond ?? 0) * duration).toFixed(2)}`
    : `$${(currentModel?.costPerImage ?? 0).toFixed(2)}`;

  return (
    <div className="space-y-8">
      {mode === "input" && (
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
            <Wand2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="font-heading text-3xl font-bold tracking-tight">Generate</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">Create images and videos with AI-powered generation.</p>
          </div>
        </div>
      )}
    <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
      {/* Left Column */}
      <div className="space-y-5">
        {mode === "input" ? (
        <>
        {/* Media Type Toggle */}
        <Tabs
          value={mediaType}
          onValueChange={(v) => setMediaType(v as MediaType)}
        >
          <TabsList className="w-full">
            <TabsTrigger value="image" className="flex-1 gap-1.5" disabled={imageModels.length === 0}>
              <ImageIcon className="h-4 w-4" />
              Image
              {imageModels.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  {imageModels.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="video"
              className="flex-1 gap-1.5"
              disabled={videoModels.length === 0 || videoTabDisabled}
              title={videoTabReason ?? undefined}
              aria-disabled={videoTabDisabled}
            >
              <Video className="h-4 w-4" />
              Video
              {videoModels.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  {videoModels.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Brand selector — generation is brand-locked at submit time (US2). */}
        {brands.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Generating as
              </span>
              <span className="text-xs text-muted-foreground/80">
                Brand kit (prefix, banned terms, default LoRA) applies on
                submit. Toggle override below if needed.
              </span>
            </div>
            <div className="w-full sm:w-[280px]">
              <BrandSelector
                brands={brands}
                value={activeBrandId}
                onChange={setActiveBrandId}
              />
            </div>
          </div>
        )}

        {/* Brand kit applied panel (T131 / US7 / FR-015). */}
        {hasActiveKit && activeBrandKit && activeBrand && (
          <div
            className={cn(
              "rounded-lg border px-4 py-3 transition-opacity",
              brandKitOverride
                ? "border-dashed border-border/40 bg-card/20 opacity-60"
                : "border-border/60 bg-card/50"
            )}
            data-testid="brand-kit-panel"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <BrandMark brand={activeBrand} size="xs" />
                  {activeBrand.name} brand kit{" "}
                  <span className="text-muted-foreground/60 normal-case tracking-normal">
                    {brandKitOverride ? "— overridden" : "— applies on submit"}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground/80">
                  Prefix, suffix, banned terms, default LoRAs and anchor
                  references will be injected unless you override.
                </span>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={brandKitOverride}
                  onCheckedChange={setBrandKitOverride}
                />
                Override
              </label>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {activeBrandKit.promptPrefix?.trim() && (
                <KitField label="Prefix" value={activeBrandKit.promptPrefix.trim()} />
              )}
              {activeBrandKit.promptSuffix?.trim() && (
                <KitField label="Suffix" value={activeBrandKit.promptSuffix.trim()} />
              )}
              {activeBrandKit.bannedTerms.length > 0 && (
                <KitField
                  label={`Banned terms (${activeBrandKit.bannedTerms.length})`}
                  value={activeBrandKit.bannedTerms.join(", ")}
                />
              )}
              {(activeBrandKit.defaultLoraId ||
                activeBrandKit.defaultLoraIds.length > 0) && (
                <KitField
                  label="Default LoRA"
                  value={
                    [
                      activeBrandKit.defaultLoraId,
                      ...activeBrandKit.defaultLoraIds.filter(
                        (l) => l !== activeBrandKit.defaultLoraId
                      ),
                    ]
                      .filter(Boolean)
                      .join(", ") as string
                  }
                />
              )}
              {activeBrandKit.anchorReferenceIds.length > 0 && (
                <KitField
                  label={`Anchor refs (${activeBrandKit.anchorReferenceIds.length})`}
                  value="Pinned when no reference image is provided."
                />
              )}
            </div>
          </div>
        )}

        {videoTabReason && isVideo && (
          <div
            role="alert"
            className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-200/90"
          >
            <strong className="font-medium">Video unavailable.</strong>{" "}
            {videoTabReason}
          </div>
        )}

        {/* Prompt Input */}
        <Card className="relative overflow-visible">
          <CardContent className="pt-6 space-y-4">
            <div className="relative">
              <Textarea
                placeholder={
                  isVideo
                    ? "Describe the video you want to generate..."
                    : "Describe your vision..."
                }
                value={prompt}
                onChange={(e) =>
                  setPrompt(e.target.value.slice(0, PROMPT_MAX_LENGTH))
                }
                className="min-h-[140px] resize-none text-base leading-relaxed !ring-primary/30 focus-visible:!border-primary/60 focus-visible:shadow-[0_0_15px_-3px] focus-visible:shadow-primary/20"
              />
              <span className="absolute bottom-2.5 right-3 text-[11px] tabular-nums text-muted-foreground/60 select-none">
                {prompt.length}/{PROMPT_MAX_LENGTH}
              </span>
            </div>

            {/* Image Upload */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageUpload(file);
                }}
              />
              {imageInputPreviews.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {imageInputPreviews.map((preview, i) => (
                      <div key={i} className="relative group">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={preview}
                          alt={`Reference ${i + 1}`}
                          className="h-14 w-14 rounded-md object-cover ring-1 ring-border/50"
                        />
                        <button
                          type="button"
                          onClick={() => removeImageInput(i)}
                          className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    {canAddMoreImages && (
                      <>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isUploading}
                          className="flex items-center gap-1.5 rounded-md border border-dashed border-border/60 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground hover:bg-secondary/30"
                        >
                          {isUploading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Upload className="h-3 w-3" />
                          )}
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={handleRefPickerOpen}
                          className="flex items-center gap-1.5 rounded-md border border-dashed border-border/60 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground hover:bg-secondary/30"
                        >
                          <ImagePlus className="h-3 w-3" />
                          Browse
                        </button>
                      </>
                    )}
                    <span className="text-[11px] text-muted-foreground ml-auto">
                      {imageInputPreviews.length}/{MAX_REFERENCE_IMAGES} {isVideo ? "first frame" : "references"}
                    </span>
                    <button
                      type="button"
                      onClick={clearAllImageInputs}
                      className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="flex flex-1 items-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground hover:bg-secondary/30"
                  >
                    {isUploading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    {isUploading ? "Uploading..." : "Upload reference image"}
                  </button>
                  <button
                    type="button"
                    onClick={handleRefPickerOpen}
                    className="flex items-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground hover:bg-secondary/30"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    Browse
                  </button>
                </div>
              )}
            </div>

            {enhancedPrompt && (
              <div className="rounded-lg border border-primary/15 bg-primary/[0.04] p-3.5 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  Enhanced Prompt
                </div>
                <p className="text-sm leading-relaxed text-foreground/80">
                  {enhancedPrompt}
                </p>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setEnhancedPrompt("")}
                >
                  Clear enhancement
                </button>
              </div>
            )}

            {/* Active model indicator */}
            {currentModel && (
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setShowModelSelector(true)}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-secondary/50 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                >
                  {activeModelLogo ? (
                    <img src={activeModelLogo} alt="" className="h-3.5 w-3.5 rounded-sm" />
                  ) : (
                    <Wand2 className="h-3 w-3" />
                  )}
                  <span className="font-medium">{activeModelLabel}</span>
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </button>
                {/* Load Brew */}
                <Popover open={brewsPopoverOpen} onOpenChange={handleBrewsPopoverOpen}>
                  <PopoverTrigger className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/50 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors cursor-pointer">
                      <FlaskConical className="h-3 w-3" />
                      <span>Brew</span>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 p-0">
                    <div className="p-3 border-b border-border/50">
                      <p className="text-xs font-medium">Load a Brew</p>
                      <p className="text-[10px] text-muted-foreground">Apply a saved recipe</p>
                    </div>
                    <div className="max-h-[280px] overflow-y-auto">
                      {isLoadingBrews ? (
                        <div className="p-4 space-y-2">
                          <Skeleton className="h-10 rounded" />
                          <Skeleton className="h-10 rounded" />
                        </div>
                      ) : userBrews.length === 0 ? (
                        <p className="p-4 text-xs text-muted-foreground text-center">
                          No brews saved yet
                        </p>
                      ) : (
                        userBrews.map((brew) => (
                          <button
                            key={brew.id}
                            onClick={() => handleLoadBrew(brew)}
                            className="w-full flex items-start gap-2.5 p-2.5 hover:bg-secondary/50 transition-colors text-left cursor-pointer border-b border-border/30 last:border-0"
                          >
                            {brew.previewUrl ? (
                              <img
                                src={brew.previewUrl}
                                alt=""
                                className="h-9 w-9 rounded object-cover shrink-0"
                              />
                            ) : (
                              <div className="h-9 w-9 rounded bg-muted/30 flex items-center justify-center shrink-0">
                                <FlaskConical className="h-3.5 w-3.5 text-muted-foreground/40" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium truncate">{brew.name}</p>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {brew.model}
                                {brew.parameters && (brew.parameters as Record<string, unknown>).loras
                                  ? ` · ${((brew.parameters as Record<string, unknown>).loras as unknown[]).length} LoRA`
                                  : ""}
                              </p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </PopoverContent>
                </Popover>

                {!isVideo && (
                  <span className="text-[11px] tabular-nums text-muted-foreground/60">
                    {activeVariant
                      ? `$${activeVariant.costPerImage.toFixed(3)}/img`
                      : `$${currentModel.costPerImage.toFixed(2)}/img`}
                  </span>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleGenerate}
                disabled={isGenerating || !prompt.trim()}
                className={`flex-1 bg-primary text-primary-foreground font-semibold shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 hover:bg-primary/90 transition-all ${
                  isReady
                    ? "animate-[subtlePulse_3s_ease-in-out_infinite]"
                    : ""
                }`}
                size="lg"
              >
                {isGenerating ? (
                  <span className="mr-2 flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary-foreground/80 animate-[bounce_1s_ease-in-out_infinite]" />
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary-foreground/80 animate-[bounce_1s_ease-in-out_0.15s_infinite]" />
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary-foreground/80 animate-[bounce_1s_ease-in-out_0.3s_infinite]" />
                  </span>
                ) : isVideo ? (
                  <Video className="mr-2 h-4 w-4" />
                ) : (
                  <Wand2 className="mr-2 h-4 w-4" />
                )}
                {isGenerating
                  ? isVideo
                    ? "Generating Video..."
                    : "Creating..."
                  : isVideo
                    ? `Generate Video (${costDisplay})`
                    : "Generate"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Prompt Enhancer */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowEnhancer(!showEnhancer)}
                className="flex items-center gap-2 text-left group"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary">
                  <Sparkles className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
                <CardTitle className="text-sm font-medium group-hover:text-foreground transition-colors">
                  Prompt Enhancer
                </CardTitle>
                {showEnhancer ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              <Switch
                checked={showEnhancer}
                onCheckedChange={setShowEnhancer}
              />
            </div>
          </CardHeader>
          {showEnhancer && (
            <CardContent className="space-y-4">
              <Tabs
                value={enhanceMode}
                onValueChange={(v) =>
                  setEnhanceMode((v ?? "template") as "template" | "llm")
                }
              >
                <TabsList className="w-full">
                  <TabsTrigger value="template" className="flex-1 gap-1.5">
                    <Zap className="h-3.5 w-3.5" />
                    Templates
                  </TabsTrigger>
                  <TabsTrigger value="llm" className="flex-1 gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    AI Rewrite
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="template" className="space-y-3 mt-3">
                  {Object.entries(modifiers).map(([category, options]) => (
                    <div key={category}>
                      <Label className="text-xs capitalize mb-1.5 block text-muted-foreground">
                        {category}
                      </Label>
                      <Select
                        value={
                          template[category as keyof PromptTemplate] ?? ""
                        }
                        onValueChange={(v) =>
                          setTemplate((prev) => ({
                            ...prev,
                            [category]: v ?? "",
                          }))
                        }
                      >
                        <SelectTrigger className="w-full bg-secondary/50 border-border/50">
                          <SelectValue placeholder={`Select ${category}`} />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((opt) => (
                            <SelectItem
                              key={opt.label}
                              value={opt.value || "none"}
                            >
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="llm" className="mt-3">
                  <div className="rounded-lg border border-dashed border-border/60 bg-secondary/30 p-4">
                    <p className="text-xs text-muted-foreground">
                      Uses Mistral AI to rewrite your prompt, optimized for the
                      selected model.
                    </p>
                  </div>
                </TabsContent>
              </Tabs>

              <Button
                onClick={handleEnhance}
                disabled={isEnhancing || !prompt.trim()}
                variant="secondary"
                className="w-full border border-border/50"
              >
                {isEnhancing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                {isEnhancing
                  ? "Enhancing..."
                  : enhanceMode === "template"
                    ? "Apply Template"
                    : "Enhance with AI"}
              </Button>
            </CardContent>
          )}
        </Card>

        {/* LoRA Browser — shown when model supports LoRAs */}
        {currentModel?.capabilities.supportsLora ? (
          <LoraBrowser
            selectedLoras={selectedLoras}
            onLorasChange={setSelectedLoras}
            onTriggerWordsChange={(words) => {
              const newWords = words.filter(
                (w) => !prompt.toLowerCase().includes(w.toLowerCase())
              );
              if (newWords.length > 0) {
                setPrompt((prev) => `${newWords.join(", ")}, ${prev}`);
              }
            }}
            nsfwEnabled={nsfwEnabled}
            onNsfwChange={setNsfwEnabled}
            baseModel={selectedModel.startsWith("wan") ? "Wan Video" : undefined}
          />
        ) : null}

        {/* Video Progress */}
        {isVideo && videoJob && videoJob.status === "processing" && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center gap-4 py-8">
                <div className="relative">
                  <div className="h-16 w-16 rounded-full border-4 border-muted" />
                  <div className="absolute inset-0 h-16 w-16 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">
                    Generating video with {currentModel?.name ?? selectedModel}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {videoJob.elapsed
                      ? `${videoJob.elapsed}s elapsed`
                      : "Starting..."}
                    {" · "}
                    Typically takes ~{currentModel?.avgGenerationTime ?? 60}s
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        </>
        ) : generatedAsset ? (
        <div className="result-entrance space-y-4">
        {/* Result Hero — no card wrapper, image fills the space */}
        <div className="relative overflow-hidden rounded-2xl shadow-2xl shadow-black/30 ring-1 ring-white/[0.06]">
          {generatedAsset.mediaType === "video" ? (
            <video
              src={generatedAsset.url}
              controls
              autoPlay
              muted
              loop
              className="w-full"
            />
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={generatedAsset.url}
                alt={generatedAsset.prompt}
                className={`w-full transition-all duration-700 ease-out ${
                  imageLoaded
                    ? "opacity-100 scale-100"
                    : "opacity-0 scale-[0.98]"
                }`}
                onLoad={() => setImageLoaded(true)}
              />
              {!imageLoaded && (
                <Skeleton className="absolute inset-0" />
              )}
            </>
          )}
        </div>

        {/* Collapsed Prompt Bar */}
        <div className="flex items-start gap-3 rounded-xl border border-border/40 bg-card/60 px-4 py-3 backdrop-blur-sm">
          <p className="flex-1 min-w-0 text-sm text-muted-foreground leading-relaxed line-clamp-2">
            {generatedAsset.prompt}
          </p>
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground/60 hover:text-foreground"
              onClick={() => {
                navigator.clipboard.writeText(generatedAsset.prompt);
                toast.success("Prompt copied");
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => handleBackToInput(false)}
            >
              <Pencil className="h-3 w-3" />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => handleBackToInput(true)}
            >
              <Sparkles className="h-3 w-3" />
              New
            </Button>
          </div>
        </div>
        </div>
        ) : null}
      </div>

      {/* Right Column */}
      <div className="space-y-5">
        {mode === "input" ? (
        <>
        <Card>
          <CardHeader className="pb-3">
            <button
              onClick={() => setShowModelSelector(!showModelSelector)}
              className="flex items-center justify-between w-full group"
            >
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-medium group-hover:text-foreground transition-colors">
                  {isVideo ? "Video Model" : "Image Model"}
                </CardTitle>
                {!showModelSelector && currentModel && (
                  <Badge variant="secondary" className="text-[11px] font-normal gap-1.5">
                    {activeModelLogo && (
                      <img src={activeModelLogo} alt="" className="h-3 w-3 rounded-sm" />
                    )}
                    {activeModelLabel}
                  </Badge>
                )}
              </div>
              {showModelSelector ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </CardHeader>
          {showModelSelector && <CardContent className="space-y-2">
            {models.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No {mediaType} models available. Configure API keys in .env.local
              </p>
            ) : (
              <div className="space-y-2">
                {models.map((model) => {
                  // A card is "selected" if the selectedModel matches its ID
                  // or any of its variant IDs
                  const variantIds = model.variants?.map((v) => v.id) ?? [];
                  const isSelected =
                    selectedModel === model.id || variantIds.includes(selectedModel as ModelInfo["id"]);
                  const logo = MODEL_LOGOS[model.id];
                  const icon = MODEL_ICONS[model.id] ?? "\u{1F3A8}";

                  // Resolve the active variant (if any) to show its metadata
                  const activeVariant = model.variants?.find(
                    (v) => v.id === selectedModel,
                  );
                  const displayCost = isVideo
                    ? `$${((activeVariant?.costPerSecond ?? model.costPerSecond ?? 0) * duration).toFixed(2)}`
                    : `$${(activeVariant?.costPerImage ?? model.costPerImage).toFixed(activeVariant ? 3 : 2)}`;
                  const displayDescription =
                    (isSelected && activeVariant?.description) || model.description;
                  const displayGenTime =
                    (isSelected && activeVariant?.avgGenerationTime) ||
                    model.avgGenerationTime;

                  return (
                    <div
                      key={model.id}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (!isSelected) {
                            setSelectedModel(model.variants?.[0]?.id ?? model.id);
                            setStyle("");
                          }
                        }
                      }}
                      onClick={() => {
                        // If card has variants and isn't already selected,
                        // select the first (default) variant
                        if (!isSelected) {
                          setSelectedModel(
                            model.variants?.[0]?.id ?? model.id,
                          );
                          setStyle("");
                        }
                      }}
                      className={`group/model w-full cursor-pointer rounded-xl border p-3.5 text-left transition-all ${
                        isSelected
                          ? "border-primary/60 bg-gradient-to-br from-primary/[0.08] to-primary/[0.03] shadow-sm shadow-primary/10 ring-1 ring-primary/20"
                          : "border-border/60 bg-gradient-to-br from-card to-card hover:from-secondary/60 hover:to-secondary/30 hover:border-border"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg transition-colors ${
                            isSelected
                              ? "bg-primary/15 ring-1 ring-primary/30"
                              : "bg-secondary ring-1 ring-border/50"
                          }`}
                        >
                          {logo ? (
                            <img
                              src={logo}
                              alt={model.name}
                              className="h-5 w-5 rounded-sm"
                            />
                          ) : (
                            icon
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold">
                              {model.name}
                            </span>
                            <Badge
                              variant={isSelected ? "default" : "secondary"}
                              className="shrink-0 text-[11px] tabular-nums"
                            >
                              {displayCost}
                            </Badge>
                          </div>

                          {/* Variant segmented control — only when card is selected and has variants */}
                          {isSelected && model.variants && model.variants.length > 1 && (
                            <div className="mt-2 flex gap-1 rounded-lg bg-secondary/80 p-0.5">
                              {model.variants.map((variant) => {
                                const isActive = selectedModel === variant.id;
                                return (
                                  <button
                                    key={variant.id}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedModel(variant.id);
                                    }}
                                    className={`flex-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                                      isActive
                                        ? "bg-background text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                    }`}
                                  >
                                    {variant.label}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed line-clamp-2">
                            {displayDescription}
                          </p>
                          <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground/70">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              ~{displayGenTime}s
                            </span>
                            {isVideo && model.capabilities.supportsAudio && (
                              <span className="flex items-center gap-1">
                                <Volume2 className="h-3 w-3" />
                                Audio
                              </span>
                            )}
                            {isVideo && model.capabilities.supportsCameraControl && (
                              <span className="flex items-center gap-1">
                                <Camera className="h-3 w-3" />
                                Camera
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>}
        </Card>

        {/* Parameters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Parameters</CardTitle>
            <CardDescription className="text-xs">
              {currentModel?.name ?? "Select a model"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Aspect Ratio */}
            <div>
              <ParamLabel>Aspect Ratio</ParamLabel>
              <div className={`mt-2 grid gap-1.5 ${
                (currentModel?.capabilities.aspectRatios?.length ?? 3) > 6
                  ? "grid-cols-4 max-h-[180px] overflow-y-auto pr-1"
                  : "grid-cols-5"
              }`}>
                {(
                  currentModel?.capabilities.aspectRatios ?? ["1:1", "16:9", "9:16"]
                ).map((ratio) => {
                  const isActive = aspectRatio === ratio;
                  return (
                    <button
                      key={ratio}
                      onClick={() => setAspectRatio(ratio)}
                      className={`flex flex-col items-center justify-center rounded-lg border px-2 py-2 text-[11px] font-medium transition-all ${
                        isActive
                          ? "border-primary/60 bg-primary/10 text-primary ring-1 ring-primary/20"
                          : "border-border/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      }`}
                    >
                      <AspectRatioPreview ratio={ratio} selected={isActive} />
                      {ratio}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Video: Duration */}
            {isVideo && currentModel?.capabilities.supportedDurations && (
              <div>
                <ParamLabel>Duration</ParamLabel>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {currentModel.capabilities.supportedDurations.map((d) => (
                    <button
                      key={d}
                      onClick={() => setDuration(d)}
                      className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                        duration === d
                          ? "border-primary/60 bg-primary/10 text-primary ring-1 ring-primary/20"
                          : "border-border/60 text-muted-foreground hover:bg-secondary"
                      }`}
                    >
                      {d}s
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Video: Audio Toggle */}
            {isVideo && currentModel?.capabilities.supportsAudio && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {audioEnabled ? (
                    <Volume2 className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <VolumeX className="h-4 w-4 text-muted-foreground" />
                  )}
                  <ParamLabel>Generate Audio</ParamLabel>
                </div>
                <Switch
                  checked={audioEnabled}
                  onCheckedChange={setAudioEnabled}
                />
              </div>
            )}

            {/* Video: Camera Control (Ray 2) */}
            {isVideo && currentModel?.capabilities.supportsCameraControl && (
              <div>
                <ParamLabel>Camera Motion</ParamLabel>
                <Select
                  value={cameraControl}
                  onValueChange={(v) => setCameraControl(v ?? "")}
                >
                  <SelectTrigger className="mt-1.5 w-full bg-secondary/50 border-border/50">
                    <SelectValue placeholder="None (auto)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None (auto)</SelectItem>
                    <SelectItem value="pan-left">Pan Left</SelectItem>
                    <SelectItem value="pan-right">Pan Right</SelectItem>
                    <SelectItem value="zoom-in">Zoom In</SelectItem>
                    <SelectItem value="zoom-out">Zoom Out</SelectItem>
                    <SelectItem value="orbit-left">Orbit Left</SelectItem>
                    <SelectItem value="orbit-right">Orbit Right</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Image: Style */}
            {!isVideo &&
              currentModel?.capabilities.styles &&
              currentModel.capabilities.styles.length > 0 && (
                <div>
                  <ParamLabel>Style</ParamLabel>
                  <Select value={style} onValueChange={(v) => setStyle(v ?? "")}>
                    <SelectTrigger className="mt-1.5 w-full bg-secondary/50 border-border/50">
                      <SelectValue placeholder="Default" />
                    </SelectTrigger>
                    <SelectContent>
                      {currentModel.capabilities.styles.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s
                            .replace(/_/g, " ")
                            .replace(/\b\w/g, (c) => c.toUpperCase())}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

            {/* Negative Prompt */}
            {currentModel?.capabilities.supportsNegativePrompt && (
              <div>
                <ParamLabel>Negative Prompt</ParamLabel>
                <Textarea
                  placeholder="What to avoid in the generation..."
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value.slice(0, 500))}
                  className="mt-1.5 min-h-[60px] resize-none text-sm bg-secondary/50 border-border/50"
                />
              </div>
            )}

            {/* Resolution */}
            {currentModel?.capabilities.supportsResolution &&
              currentModel.capabilities.resolutionOptions &&
              currentModel.capabilities.resolutionOptions.length > 0 && (
              <div>
                <ParamLabel>Resolution</ParamLabel>
                <div className="mt-2 flex gap-1.5">
                  {currentModel.capabilities.resolutionOptions.map((res) => (
                    <button
                      key={res}
                      onClick={() => setModelResolution(modelResolution === res ? "" : res)}
                      className={`flex-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all ${
                        modelResolution === res
                          ? "border-primary/60 bg-primary/10 text-primary ring-1 ring-primary/20"
                          : "border-border/60 text-muted-foreground hover:bg-secondary"
                      }`}
                    >
                      {res}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Rendering Speed (Ideogram) */}
            {currentModel?.capabilities.supportsRenderingSpeed && (
              <div>
                <ParamLabel>Rendering Speed</ParamLabel>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {["TURBO", "DEFAULT", "QUALITY"].map((speed) => (
                    <button
                      key={speed}
                      onClick={() => setRenderingSpeed(renderingSpeed === speed ? "" : speed)}
                      className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all ${
                        renderingSpeed === speed
                          ? "border-primary/60 bg-primary/10 text-primary ring-1 ring-primary/20"
                          : "border-border/60 text-muted-foreground hover:bg-secondary"
                      }`}
                    >
                      {speed.charAt(0) + speed.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Output Format */}
            {currentModel?.capabilities.supportsOutputFormat && (
              <div>
                <ParamLabel>Output Format</ParamLabel>
                <div className="mt-2 flex gap-1.5">
                  {["png", "jpeg"].map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => setOutputFormat(outputFormat === fmt ? "" : fmt)}
                      className={`flex-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium uppercase transition-all ${
                        outputFormat === fmt
                          ? "border-primary/60 bg-primary/10 text-primary ring-1 ring-primary/20"
                          : "border-border/60 text-muted-foreground hover:bg-secondary"
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Seed */}
            {currentModel?.capabilities.supportsSeed && (
              <div>
                <ParamLabel>Seed</ParamLabel>
                <input
                  type="number"
                  placeholder="Random"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-border/50 bg-secondary/50 px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            )}

            {/* Guidance (Flux Dev) */}
            {currentModel?.capabilities.supportsGuidance && (
              <div>
                <Label className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  Guidance {guidance ? `(${guidance})` : ""}
                  <Tooltip>
                    <TooltipTrigger
                      className="text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-help"
                      onClick={(e) => e.preventDefault()}
                    >
                      <Info className="h-3 w-3" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[220px]">
                      {PARAM_TOOLTIPS["Guidance"]}
                    </TooltipContent>
                  </Tooltip>
                </Label>
                <input
                  type="range"
                  min="1.5"
                  max="5"
                  step="0.1"
                  value={guidance || "3.0"}
                  onChange={(e) => setGuidance(e.target.value)}
                  className="mt-2 w-full accent-primary"
                />
              </div>
            )}

            {/* Steps (Flux Dev) */}
            {currentModel?.capabilities.supportsSteps && (
              <div>
                <Label className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  Steps {steps ? `(${steps})` : ""}
                  <Tooltip>
                    <TooltipTrigger
                      className="text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-help"
                      onClick={(e) => e.preventDefault()}
                    >
                      <Info className="h-3 w-3" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[220px]">
                      {PARAM_TOOLTIPS["Steps"]}
                    </TooltipContent>
                  </Tooltip>
                </Label>
                <input
                  type="range"
                  min="1"
                  max="50"
                  step="1"
                  value={steps || "28"}
                  onChange={(e) => setSteps(e.target.value)}
                  className="mt-2 w-full accent-primary"
                />
              </div>
            )}

            {/* CFG Scale (Kling) */}
            {currentModel?.capabilities.supportsCfgScale && (
              <div>
                <Label className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  CFG Scale {cfgScale ? `(${cfgScale})` : ""}
                  <Tooltip>
                    <TooltipTrigger
                      className="text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-help"
                      onClick={(e) => e.preventDefault()}
                    >
                      <Info className="h-3 w-3" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[220px]">
                      {PARAM_TOOLTIPS["CFG Scale"]}
                    </TooltipContent>
                  </Tooltip>
                </Label>
                <input
                  type="range"
                  min="0.3"
                  max="0.7"
                  step="0.05"
                  value={cfgScale || "0.5"}
                  onChange={(e) => setCfgScale(e.target.value)}
                  className="mt-2 w-full accent-primary"
                />
              </div>
            )}

            {/* Person Generation (Google) */}
            {currentModel?.capabilities.supportsPersonGeneration && (
              <div>
                <ParamLabel>Person Generation</ParamLabel>
                <Select value={personGeneration} onValueChange={(v) => setPersonGeneration(v ?? "")}>
                  <SelectTrigger className="mt-1.5 w-full bg-secondary/50 border-border/50">
                    <SelectValue placeholder="Allow Adults (default)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="allow_all">Allow All</SelectItem>
                    <SelectItem value="allow_adult">Allow Adults</SelectItem>
                    <SelectItem value="dont_allow">Don&apos;t Allow</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Toggles */}
            {(currentModel?.capabilities.supportsWatermarkToggle ||
              currentModel?.capabilities.supportsPromptEnhance ||
              currentModel?.capabilities.supportsPromptOptimizer ||
              currentModel?.capabilities.supportsLoop) && (
              <div className="space-y-3">
                {currentModel?.capabilities.supportsWatermarkToggle && (
                  <div className="flex items-center justify-between">
                    <ParamLabel>Watermark</ParamLabel>
                    <Switch checked={watermark} onCheckedChange={setWatermark} />
                  </div>
                )}
                {currentModel?.capabilities.supportsPromptEnhance && (
                  <div className="flex items-center justify-between">
                    <ParamLabel>Provider Prompt Enhance</ParamLabel>
                    <Switch checked={promptEnhance} onCheckedChange={setPromptEnhance} />
                  </div>
                )}
                {currentModel?.capabilities.supportsPromptOptimizer && (
                  <div className="flex items-center justify-between">
                    <ParamLabel>Prompt Optimizer</ParamLabel>
                    <Switch checked={promptOptimizer} onCheckedChange={setPromptOptimizer} />
                  </div>
                )}
                {currentModel?.capabilities.supportsLoop && (
                  <div className="flex items-center justify-between">
                    <ParamLabel>Loop Video</ParamLabel>
                    <Switch checked={loop} onCheckedChange={setLoop} />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        </>
        ) : generatedAsset ? (
        <div className="result-entrance space-y-4">
        {/* Primary Action */}
        <Button
          className="w-full gap-2 h-11"
          onClick={() => {
            const a = document.createElement("a");
            a.href = generatedAsset.url;
            a.download = `${generatedAsset.id}.${generatedAsset.mediaType === "video" ? "mp4" : "png"}`;
            a.click();
          }}
        >
          <Download className="h-4 w-4" />
          Download
        </Button>

        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={handleGenerate}
        >
          <RotateCcw className="h-4 w-4" />
          Regenerate
        </Button>

        {/* Image Tools */}
        {generatedAsset.mediaType === "image" && (
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Tools</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs justify-start"
                  onClick={async () => {
                    toast.loading("Upscaling...", { id: "tool" });
                    try {
                      const res = await fetch("/api/generate/tools", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "upscale", imageUrl: generatedAsset.url, provider: "recraft" }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error);
                      setGeneratedAsset({ ...generatedAsset, url: data.url, width: data.width, height: data.height });
                      setImageLoaded(false);
                      toast.success("Upscaled!", { id: "tool" });
                    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed", { id: "tool" }); }
                  }}
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  Upscale
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs justify-start"
                  onClick={async () => {
                    toast.loading("Removing background...", { id: "tool" });
                    try {
                      const res = await fetch("/api/generate/tools", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "remove-background", imageUrl: generatedAsset.url }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error);
                      setGeneratedAsset({ ...generatedAsset, url: data.url, width: data.width, height: data.height });
                      setImageLoaded(false);
                      toast.success("Background removed!", { id: "tool" });
                    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed", { id: "tool" }); }
                  }}
                >
                  <Eraser className="h-3.5 w-3.5" />
                  Remove BG
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs justify-start"
                  onClick={async () => {
                    toast.loading("Vectorizing...", { id: "tool" });
                    try {
                      const res = await fetch("/api/generate/tools", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "vectorize", imageUrl: generatedAsset.url }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error);
                      const a = document.createElement("a");
                      a.href = data.url;
                      a.download = `${generatedAsset.id}.svg`;
                      a.click();
                      toast.success("SVG downloaded!", { id: "tool" });
                    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed", { id: "tool" }); }
                  }}
                >
                  <FileType className="h-3.5 w-3.5" />
                  Vectorize
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs justify-start"
                  onClick={() => {
                    setImageInputs([generatedAsset.url]);
                    setImageInputPreviews([generatedAsset.url]);
                    handleBackToInput(false);
                    toast.info("Image set as input. Enter a new prompt to edit it.");
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Brand Tagger */}
        {brands.length > 0 && (
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Brand</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="flex flex-wrap gap-1.5">
                {brands.map((brand) => {
                  const isActive = assetBrands.includes(brand.id);
                  return (
                    <button
                      key={brand.id}
                      onClick={async () => {
                        const next = isActive
                          ? assetBrands.filter((b) => b !== brand.id)
                          : [...assetBrands, brand.id];
                        setAssetBrands(next);
                        try {
                          await fetch(`/api/assets/${generatedAsset.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ brands: next }),
                          });
                          toast.success(isActive ? `Removed ${brand.name}` : `Tagged ${brand.name}`);
                        } catch {
                          toast.error("Failed to update brand");
                          setAssetBrands(assetBrands);
                        }
                      }}
                      className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium cursor-pointer transition-all hover:opacity-80 hover:scale-105"
                      style={{
                        backgroundColor: isActive ? `${brand.color}20` : undefined,
                        borderColor: isActive ? `${brand.color}60` : undefined,
                        color: isActive ? brand.color : undefined,
                      }}
                    >
                      {isActive ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Tag className="h-3 w-3" />
                      )}
                      {brand.name}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Save as Brew */}
        <Button
          variant="outline"
          className="w-full gap-2 cursor-pointer"
          onClick={() => {
            setBrewName("");
            setBrewDescription("");
            setBrewIncludePrompt(true);
            setShowSaveBrew(true);
          }}
        >
          <FlaskConical className="h-4 w-4" />
          Save as Brew
        </Button>

        {/* Details */}
        <div className="space-y-2.5 px-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Model</span>
            <Badge variant="secondary" className="gap-1 font-normal text-[11px]">
              <span>{MODEL_ICONS[generatedAsset.model] ?? "\u{1F3A8}"}</span>
              {generatedAsset.model}
            </Badge>
          </div>
          {generatedAsset.width && generatedAsset.height && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Dimensions</span>
              <span className="text-xs tabular-nums text-muted-foreground">{generatedAsset.width} x {generatedAsset.height}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Cost</span>
            <span className="text-xs tabular-nums text-muted-foreground">${generatedAsset.costEstimate.toFixed(3)}</span>
          </div>
          {generatedAsset.mediaType === "video" && generatedAsset.duration && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Duration</span>
              <span className="text-xs tabular-nums text-muted-foreground">{generatedAsset.duration}s</span>
            </div>
          )}
        </div>
        </div>
        ) : null}
      </div>

      <style>{`
        @keyframes subtlePulse {
          0%, 100% { box-shadow: 0 4px 6px -1px color-mix(in oklch, var(--primary) 20%, transparent); }
          50% { box-shadow: 0 4px 14px -1px color-mix(in oklch, var(--primary) 35%, transparent); }
        }
        @keyframes resultEntrance {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .result-entrance {
          animation: resultEntrance 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

    {/* Save as Brew Dialog */}
    <Dialog open={showSaveBrew} onOpenChange={setShowSaveBrew}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Save as Brew
          </DialogTitle>
          <DialogDescription>
            Save this generation recipe for quick reuse.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="brew-save-name">Name</Label>
            <Input
              id="brew-save-name"
              value={brewName}
              onChange={(e) => setBrewName(e.target.value)}
              placeholder="e.g. Anime Portrait Setup"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="brew-save-desc">Description (optional)</Label>
            <Textarea
              id="brew-save-desc"
              value={brewDescription}
              onChange={(e) => setBrewDescription(e.target.value)}
              placeholder="What's this brew for?"
              rows={2}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="brew-include-prompt"
              checked={brewIncludePrompt}
              onCheckedChange={setBrewIncludePrompt}
            />
            <Label htmlFor="brew-include-prompt" className="text-sm cursor-pointer">
              Include prompt text
            </Label>
          </div>

          {/* Preview of what's being saved */}
          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 space-y-1.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-foreground">{activeModelLabel}</span>
              {selectedLoras.length > 0 ? (
                <Badge variant="secondary" className="text-[9px]">
                  {selectedLoras.length} LoRA{selectedLoras.length > 1 ? "s" : ""}
                </Badge>
              ) : null}
            </div>
            {brewIncludePrompt && prompt ? (
              <p className="line-clamp-2 italic">"{prompt}"</p>
            ) : (
              <p className="opacity-60">Config only — no prompt</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setShowSaveBrew(false)}>Cancel</Button>
          <Button onClick={handleSaveBrew} disabled={!brewName.trim() || isSavingBrew}>
            {isSavingBrew ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Save Brew
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Reference Picker Dialog */}
    <Dialog open={showRefPicker} onOpenChange={setShowRefPicker}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus className="h-5 w-5" />
            Browse References
          </DialogTitle>
          <DialogDescription>
            Select a reference image from your uploads or gallery.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="uploads" onValueChange={(v) => { if (v === "gallery") handleGalleryPickerLoad(); }}>
          <TabsList className="w-full">
            <TabsTrigger value="uploads" className="flex-1">Uploads</TabsTrigger>
            <TabsTrigger value="gallery" className="flex-1">Gallery</TabsTrigger>
          </TabsList>

          {/* Uploads tab */}
          <TabsContent value="uploads" className="mt-3">
            {refPickerLoading && refPickerItems.length === 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-square rounded-lg" />
                ))}
              </div>
            ) : refPickerItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No reference images yet. Upload one above.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {refPickerItems.map((ref) => (
                    <button
                      key={ref.id}
                      type="button"
                      onClick={() => handleRefPickerSelect(ref)}
                      className="group relative aspect-square overflow-hidden rounded-lg bg-muted cursor-pointer transition-all hover:ring-2 hover:ring-primary focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={ref.thumbnailUrl}
                        alt={ref.fileName ?? "Reference"}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
                {refPickerCursor && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2"
                    onClick={handleRefPickerLoadMore}
                    disabled={refPickerLoading}
                  >
                    {refPickerLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Load more
                  </Button>
                )}
              </>
            )}
          </TabsContent>

          {/* Gallery tab */}
          <TabsContent value="gallery" className="mt-3">
            {galleryPickerLoading && galleryPickerItems.length === 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-square rounded-lg" />
                ))}
              </div>
            ) : galleryPickerItems.length === 0 && galleryPickerLoaded ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No generated images yet.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {galleryPickerItems.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => handleRefPickerSelect(asset)}
                      className="group relative aspect-square overflow-hidden rounded-lg bg-muted cursor-pointer transition-all hover:ring-2 hover:ring-primary focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={asset.thumbnailUrl}
                        alt={asset.prompt}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="line-clamp-2 text-[10px] text-white/90 leading-tight">{asset.prompt}</p>
                      </div>
                    </button>
                  ))}
                </div>
                {galleryPickerCursor && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2"
                    onClick={handleGalleryPickerLoadMore}
                    disabled={galleryPickerLoading}
                  >
                    {galleryPickerLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Load more
                  </Button>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
    </div>
    </div>
  );
}

function KitField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 px-2.5 py-1.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 line-clamp-2 text-xs text-foreground/85">
        {value}
      </div>
    </div>
  );
}
