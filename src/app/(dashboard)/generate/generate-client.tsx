"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import type { ModelInfo, ModelVariant, PromptTemplate, MediaType } from "@/types";
import type { promptModifiers as PromptModifiersType } from "@/providers/prompt-improver";

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
}

/** Logo path per model card (variants share the parent's logo) */
const MODEL_LOGOS: Record<string, string> = {
  "imagen-4": "/logos/gemini.png",
  "grok-imagine": "/logos/xai.png",
  "flux-1.1-pro": "/logos/bfl.png",
  "ideogram-3": "/logos/ideogram.png",
  "recraft-v3": "/logos/recraft.png",
};

/** Fallback emoji for models without a logo (e.g. video providers) */
const MODEL_ICONS: Record<string, string> = {
  "veo-3": "\u{1F3AC}",
  "runway-gen4-turbo": "\u{1F3AC}",
  "kling-2.1": "\u{1F3AC}",
  "hailuo-2.3": "\u{1F3AC}",
  "ray-2": "\u{1F3AC}",
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
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [style, setStyle] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [generatedAsset, setGeneratedAsset] = useState<GeneratedAsset | null>(null);
  const [enhanceMode, setEnhanceMode] = useState<"template" | "llm">("template");
  const [template, setTemplate] = useState<PromptTemplate>({});
  const [showEnhancer, setShowEnhancer] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(true);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Brands
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [assetBrands, setAssetBrands] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/brands")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setBrands(data);
      })
      .catch(() => {});
  }, []);

  // Image input state
  const [imageInput, setImageInput] = useState("");
  const [imageInputPreview, setImageInputPreview] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setImageInput(data.url);
      setImageInputPreview(URL.createObjectURL(file));
      toast.success("Image uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  function clearImageInput() {
    setImageInput("");
    setImageInputPreview("");
    if (fileInputRef.current) fileInputRef.current.value = "";
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
      };

      if (imageInput) body.imageInput = imageInput;

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

  const costDisplay = isVideo
    ? `$${((currentModel?.costPerSecond ?? 0) * duration).toFixed(2)}`
    : `$${(currentModel?.costPerImage ?? 0).toFixed(2)}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
      {/* Left: Prompt & Controls */}
      <div className="space-y-5">
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
            <TabsTrigger value="video" className="flex-1 gap-1.5" disabled={videoModels.length === 0}>
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
              {imageInputPreview ? (
                <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-secondary/30 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageInputPreview}
                    alt="Input image"
                    className="h-14 w-14 rounded-md object-cover ring-1 ring-border/50"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">Reference image</p>
                    <p className="text-[11px] text-muted-foreground">
                      {isVideo ? "Will be used as first frame" : "Uploaded as reference"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={clearImageInput}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground hover:bg-secondary/30"
                >
                  {isUploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  {isUploading ? "Uploading..." : "Upload reference image"}
                </button>
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

        {/* Generated Result */}
        {!isGenerating && generatedAsset && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                {generatedAsset.mediaType === "video" ? (
                  <Video className="h-4 w-4 text-primary" />
                ) : (
                  <ImageIcon className="h-4 w-4 text-primary" />
                )}
                Result
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="relative overflow-hidden rounded-xl shadow-lg shadow-black/20 ring-1 ring-foreground/5">
                  {generatedAsset.mediaType === "video" ? (
                    <video
                      src={generatedAsset.url}
                      controls
                      autoPlay
                      muted
                      loop
                      className="w-full rounded-xl"
                    />
                  ) : (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={generatedAsset.url}
                        alt={generatedAsset.prompt}
                        className={`w-full rounded-xl transition-all duration-700 ease-out ${
                          imageLoaded
                            ? "opacity-100 scale-100"
                            : "opacity-0 scale-[0.98]"
                        }`}
                        onLoad={() => setImageLoaded(true)}
                      />
                      {!imageLoaded && (
                        <Skeleton className="absolute inset-0 rounded-xl" />
                      )}
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="gap-1 font-normal">
                    <span>{MODEL_ICONS[generatedAsset.model] ?? "\u{1F3A8}"}</span>
                    {generatedAsset.model}
                  </Badge>
                  {generatedAsset.mediaType === "video" && generatedAsset.duration && (
                    <Badge variant="outline" className="gap-1 font-normal">
                      <Clock className="h-3 w-3" />
                      {generatedAsset.duration}s
                    </Badge>
                  )}
                  {generatedAsset.width && generatedAsset.height && (
                    <Badge variant="outline" className="gap-1 font-normal">
                      {generatedAsset.width} x {generatedAsset.height}
                    </Badge>
                  )}
                  <Badge variant="outline" className="gap-1 font-normal">
                    <DollarSign className="h-3 w-3" />
                    {generatedAsset.costEstimate.toFixed(3)}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = generatedAsset.url;
                      a.download = `${generatedAsset.id}.${generatedAsset.mediaType === "video" ? "mp4" : "png"}`;
                      a.click();
                    }}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={handleGenerate}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Regenerate
                  </Button>
                </div>

                {/* Brand Tagger */}
                {brands.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Brand</p>
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
                  </div>
                )}

                {/* Image Tools */}
                {generatedAsset.mediaType === "image" && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Tools</p>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="gap-1.5 text-xs"
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
                        <Maximize2 className="h-3 w-3" />
                        Upscale
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="gap-1.5 text-xs"
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
                        <Eraser className="h-3 w-3" />
                        Remove BG
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="gap-1.5 text-xs"
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
                        <FileType className="h-3 w-3" />
                        Vectorize
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="gap-1.5 text-xs"
                        onClick={() => {
                          setImageInput(generatedAsset.url);
                          setImageInputPreview(generatedAsset.url);
                          toast.info("Image set as input. Enter a new prompt to edit it.");
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right: Model & Parameters */}
      <div className="space-y-5">
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
      </div>

      <style>{`
        @keyframes subtlePulse {
          0%, 100% { box-shadow: 0 4px 6px -1px color-mix(in oklch, var(--primary) 20%, transparent); }
          50% { box-shadow: 0 4px 14px -1px color-mix(in oklch, var(--primary) 35%, transparent); }
        }
      `}</style>
    </div>
  );
}
