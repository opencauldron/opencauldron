"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Search,
  Download,
  Trash2,
  Calendar,
  X,
  ImageIcon,
  Loader2,
  Play,
  Video,
  Volume2,
  Clock,
  Wand2,
  Tag,
  Check,
  FlaskConical,
  ImagePlus,
  Send,
  GitFork,
} from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useRouter } from "next/navigation";
import { normalizeImageInputs } from "@/lib/normalize-image-inputs";

const PROVIDER_LABELS: Record<string, string> = {
  google: "Gemini",
  xai: "Grok",
  bfl: "Flux",
  ideogram: "Ideogram",
  recraft: "Recraft",
  runway: "Runway",
  fal: "Kling",
  minimax: "Hailuo",
  luma: "Luma",
};

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

interface AssetBrand {
  id: string;
  name: string;
  color: string;
}

interface AssetUser {
  name: string | null;
  email: string | null;
  image: string | null;
}

interface GalleryAsset {
  id: string;
  userId: string;
  brandId: string | null;
  status: "draft" | "in_review" | "approved" | "rejected" | "archived" | null;
  parentAssetId: string | null;
  mediaType: string;
  model: string;
  provider: string;
  prompt: string;
  enhancedPrompt: string | null;
  parameters: Record<string, unknown> | null;
  url: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
  fileSize: number | null;
  costEstimate: number;
  duration: number | null;
  hasAudio: boolean | null;
  createdAt: string;
  brands: AssetBrand[];
  tags: string[];
  user: AssetUser;
}

const MODEL_OPTIONS = [
  { value: "", label: "All Models" },
  { value: "imagen-4", label: "Imagen 4" },
  { value: "imagen-flash", label: "Imagen Flash" },
  { value: "imagen-flash-lite", label: "Imagen Lite" },
  { value: "grok-imagine", label: "Grok Imagine" },
  { value: "grok-imagine-pro", label: "Grok Pro" },
  { value: "flux-1.1-pro", label: "Flux Pro" },
  { value: "flux-dev", label: "Flux Dev" },
  { value: "ideogram-3", label: "Ideogram 3" },
  { value: "recraft-v3", label: "Recraft V3" },
  { value: "recraft-20b", label: "Recraft 20B" },
  { value: "veo-3", label: "Veo 3" },
  { value: "runway-gen4-turbo", label: "Gen-4 Turbo" },
  { value: "kling-2.1", label: "Kling 2.1" },
  { value: "hailuo-2.3", label: "Hailuo 2.3" },
  { value: "ray-2", label: "Ray 2" },
];

const MEDIA_TYPE_OPTIONS = [
  { value: "", label: "All Media" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
];

// -------------------------------------------------------------------
// Main Gallery Component
// -------------------------------------------------------------------

export function GalleryClient() {
  const router = useRouter();
  const [assets, setAssets] = useState<GalleryAsset[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<GalleryAsset | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Save as Brew
  const [brewAsset, setBrewAsset] = useState<GalleryAsset | null>(null);
  const [brewName, setBrewName] = useState("");
  const [brewDescription, setBrewDescription] = useState("");
  const [brewIncludePrompt, setBrewIncludePrompt] = useState(true);
  const [isSavingBrew, setIsSavingBrew] = useState(false);

  // Brands
  const [allBrands, setAllBrands] = useState<AssetBrand[]>([]);

  useEffect(() => {
    fetch("/api/brands")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setAllBrands(data); })
      .catch(() => {});
  }, []);

  async function toggleBrand(asset: GalleryAsset, brandId: string) {
    const current = asset.brands.map((b) => b.id);
    const isActive = current.includes(brandId);
    const next = isActive ? current.filter((b) => b !== brandId) : [...current, brandId];

    try {
      const res = await fetch(`/api/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brands: next }),
      });
      if (!res.ok) throw new Error();

      const brand = allBrands.find((b) => b.id === brandId)!;
      const updatedBrands = isActive
        ? asset.brands.filter((b) => b.id !== brandId)
        : [...asset.brands, brand];

      const updated = { ...asset, brands: updatedBrands };
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? updated : a)));
      setSelectedAsset(updated);
    } catch {
      // silent fail
    }
  }

  // Filters
  const [modelFilter, setModelFilter] = useState("");
  const [mediaTypeFilter, setMediaTypeFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const observerRef = useRef<HTMLDivElement>(null);

  const buildQuery = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams();
      if (modelFilter) params.set("model", modelFilter);
      if (mediaTypeFilter) params.set("mediaType", mediaTypeFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (cursor) params.set("cursor", cursor);
      params.set("limit", "30");
      return params.toString();
    },
    [modelFilter, mediaTypeFilter, searchQuery]
  );

  const fetchAssets = useCallback(
    async (cursor?: string) => {
      try {
        const query = buildQuery(cursor);
        const res = await fetch(`/api/assets?${query}`);
        if (!res.ok) throw new Error("Failed to fetch assets");
        const data = await res.json();

        let filtered = data.assets as GalleryAsset[];
        if (dateFrom) {
          const from = new Date(dateFrom);
          filtered = filtered.filter((a) => new Date(a.createdAt) >= from);
        }
        if (dateTo) {
          const to = new Date(dateTo);
          to.setHours(23, 59, 59, 999);
          filtered = filtered.filter((a) => new Date(a.createdAt) <= to);
        }

        if (cursor) {
          setAssets((prev) => [...prev, ...filtered]);
        } else {
          setAssets(filtered);
        }
        setNextCursor(data.nextCursor);
      } catch (error) {
        console.error("Failed to fetch assets:", error);
      }
    },
    [buildQuery, dateFrom, dateTo]
  );

  useEffect(() => {
    setLoading(true);
    fetchAssets().finally(() => setLoading(false));
  }, [fetchAssets]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    await fetchAssets(nextCursor);
    setLoadingMore(false);
  }, [nextCursor, loadingMore, fetchAssets]);

  useEffect(() => {
    const el = observerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && nextCursor && !loadingMore) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [nextCursor, loadingMore, loadMore]);

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/assets/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setAssets((prev) => prev.filter((a) => a.id !== id));
      setSelectedAsset(null);
      setDeleteConfirm(null);
    } catch (error) {
      console.error("Failed to delete asset:", error);
    } finally {
      setDeleting(false);
    }
  };

  const handleDownload = (asset: GalleryAsset) => {
    const a = document.createElement("a");
    a.href = asset.url;
    const ext = asset.mediaType === "video" ? "mp4" : "png";
    a.download = `${asset.model}-${asset.id.slice(0, 8)}.${ext}`;
    a.click();
  };

  const handleAnimate = (asset: GalleryAsset) => {
    // Navigate to generate page with image-to-video params
    const params = new URLSearchParams({
      mediaType: "video",
      imageInput: asset.url,
      prompt: asset.prompt,
    });
    router.push(`/generate?${params.toString()}`);
  };

  const handleSaveAsBrew = async () => {
    if (!brewAsset || !brewName.trim()) return;
    setIsSavingBrew(true);
    try {
      const res = await fetch("/api/brews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: brewName.trim(),
          description: brewDescription.trim() || undefined,
          model: brewAsset.model,
          prompt: brewIncludePrompt ? brewAsset.prompt : undefined,
          enhancedPrompt: brewIncludePrompt ? brewAsset.enhancedPrompt : undefined,
          parameters: brewAsset.parameters,
          previewUrl: brewAsset.thumbnailUrl || brewAsset.url,
          imageInput: normalizeImageInputs((brewAsset.parameters as Record<string, unknown> | null)?.imageInput) || undefined,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error("Save brew error:", res.status, text);
        throw new Error("Failed to save");
      }
      toast.success("Brew saved!");
      setBrewAsset(null);
      setBrewName("");
      setBrewDescription("");
    } catch {
      toast.error("Failed to save brew");
    } finally {
      setIsSavingBrew(false);
    }
  };

  const handleSubmitForReview = async (asset: GalleryAsset) => {
    try {
      const res = await fetch(`/api/assets/${asset.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body.error === "personal_brand_no_review") {
          toast.error("Personal-brand assets can't be submitted for review.");
        } else if (body.error === "invalid_transition") {
          toast.error("Only drafts can be submitted.");
        } else {
          toast.error(`Couldn't submit: ${body.error ?? res.statusText}`);
        }
        return;
      }
      toast.success("Submitted for review");
      const updated: GalleryAsset = { ...asset, status: "in_review" };
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? updated : a)));
      setSelectedAsset(updated);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("opencauldron:review-changed"));
      }
    } catch {
      toast.error("Network error");
    }
  };

  const handleFork = async (asset: GalleryAsset) => {
    try {
      const res = await fetch(`/api/assets/${asset.id}/fork`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body.error === "fork_requires_approved") {
          toast.error("Only approved assets can be forked.");
        } else {
          toast.error(`Couldn't fork: ${body.error ?? res.statusText}`);
        }
        return;
      }
      const data = (await res.json()) as {
        asset: { id: string; brandId: string | null };
      };
      toast.success("Forked — opening editor");
      const params = new URLSearchParams({
        prompt: asset.prompt,
        model: asset.model,
        mediaType: asset.mediaType,
        forkOf: data.asset.id,
      });
      if (data.asset.brandId) params.set("brandId", data.asset.brandId);
      router.push(`/generate?${params.toString()}`);
    } catch {
      toast.error("Network error");
    }
  };

  const hasFilters = modelFilter || mediaTypeFilter || searchQuery || dateFrom || dateTo;
  const clearFilters = () => {
    setModelFilter("");
    setMediaTypeFilter("");
    setSearchQuery("");
    setDateFrom("");
    setDateTo("");
  };

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-36">
          <Select
            value={mediaTypeFilter}
            onValueChange={(v) => setMediaTypeFilter(v ?? "")}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All Media" />
            </SelectTrigger>
            <SelectContent>
              {MEDIA_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-44">
          <Select
            value={modelFilter}
            onValueChange={(v) => setModelFilter(v ?? "")}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All Models" />
            </SelectTrigger>
            <SelectContent>
              {MODEL_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search prompts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Calendar className="size-4 text-muted-foreground" />
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-36"
            />
          </div>
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-36"
          />
        </div>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="size-3.5 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-square w-full rounded-lg" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && assets.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
          <ImageIcon className="size-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium">No assets found</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            {hasFilters
              ? "Try adjusting your filters or search query."
              : "Generate some images or videos to see them here."}
          </p>
          {hasFilters && (
            <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
              Clear Filters
            </Button>
          )}
        </div>
      )}

      {/* Grid */}
      {!loading && assets.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <GalleryCard
              key={asset.id}
              asset={asset}
              onClick={() => setSelectedAsset(asset)}
            />
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      {nextCursor && (
        <div ref={observerRef} className="flex justify-center py-6">
          {loadingMore ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading more...
            </div>
          ) : (
            <Button variant="outline" onClick={loadMore}>
              Load More
            </Button>
          )}
        </div>
      )}

      {/* Lightbox Dialog */}
      <Dialog
        open={!!selectedAsset}
        onOpenChange={(open) => {
          if (!open) setSelectedAsset(null);
        }}
      >
        {selectedAsset && (
          <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Asset Details</DialogTitle>
              <DialogDescription>
                Generated with {getModelLabel(selectedAsset.model)}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-6 md:grid-cols-[1fr_300px]">
              {/* Media */}
              <div className="relative aspect-auto min-h-[300px] overflow-hidden rounded-lg bg-muted">
                {selectedAsset.mediaType === "video" ? (
                  <video
                    src={selectedAsset.url}
                    controls
                    autoPlay
                    muted
                    className="h-full w-full object-contain rounded-lg"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selectedAsset.url}
                    alt={selectedAsset.prompt}
                    className="h-full w-full object-contain"
                  />
                )}
              </div>

              {/* Metadata Panel */}
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">
                    Prompt
                  </h4>
                  <p className="text-sm leading-relaxed">
                    {selectedAsset.prompt}
                  </p>
                </div>

                {selectedAsset.enhancedPrompt && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">
                      Enhanced Prompt
                    </h4>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {selectedAsset.enhancedPrompt}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {getModelLabel(selectedAsset.model)}
                  </Badge>
                  <Badge variant="outline">{PROVIDER_LABELS[selectedAsset.provider] ?? selectedAsset.provider}</Badge>
                  {selectedAsset.mediaType === "video" && (
                    <Badge variant="outline" className="gap-1">
                      <Video className="size-3" />
                      Video
                    </Badge>
                  )}
                </div>

                {/* Video metadata */}
                {selectedAsset.mediaType === "video" && (
                  <div className="flex gap-3">
                    {selectedAsset.duration && (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="size-3.5" />
                        {selectedAsset.duration}s
                      </div>
                    )}
                    {selectedAsset.hasAudio && (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Volume2 className="size-3.5" />
                        Audio
                      </div>
                    )}
                  </div>
                )}

                {(() => {
                  const params = selectedAsset.parameters;
                  if (!params) return null;
                  const entries = Object.entries(params).filter(
                    ([key, v]) => v != null && v !== "" && key !== "imageInput" && key !== "loras"
                  );
                  return entries.length > 0 ? (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-1">
                        Parameters
                      </h4>
                      <div className="flex flex-wrap gap-1">
                        {entries.map(([key, value]) => (
                          <Badge key={key} variant="outline" className="text-xs">
                            {key}: {String(value)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}

                {normalizeImageInputs(selectedAsset.parameters?.imageInput).length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">
                      Reference {normalizeImageInputs(selectedAsset.parameters?.imageInput).length > 1 ? "Images" : "Image"}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {normalizeImageInputs(selectedAsset.parameters?.imageInput).map((url, i) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`Reference ${i + 1}`}
                            className="h-20 w-20 rounded-md object-cover ring-1 ring-border/50 hover:ring-primary transition-all cursor-pointer"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {(selectedAsset.width || selectedAsset.height) && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">
                      Dimensions
                    </h4>
                    <p className="text-sm">
                      {selectedAsset.width} x {selectedAsset.height}px
                      {selectedAsset.fileSize && (
                        <span className="text-muted-foreground ml-2">
                          ({formatFileSize(selectedAsset.fileSize)})
                        </span>
                      )}
                    </p>
                  </div>
                )}

                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">
                    Creator
                  </h4>
                  <p className="text-sm">
                    {selectedAsset.user.name ?? selectedAsset.user.email ?? "Unknown"}
                  </p>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">
                    Created
                  </h4>
                  <p className="text-sm">
                    {new Date(selectedAsset.createdAt).toLocaleDateString(
                      undefined,
                      {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }
                    )}
                  </p>
                </div>

                {allBrands.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">
                      Brand
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {allBrands.map((brand) => {
                        const isActive = selectedAsset.brands.some((b) => b.id === brand.id);
                        return (
                          <button
                            key={brand.id}
                            onClick={() => toggleBrand(selectedAsset, brand.id)}
                            className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium cursor-pointer transition-all hover:opacity-80 hover:scale-105"
                            style={{
                              backgroundColor: isActive ? `${brand.color}20` : undefined,
                              borderColor: isActive ? `${brand.color}60` : undefined,
                              color: isActive ? brand.color : undefined,
                            }}
                          >
                            {isActive ? <Check className="h-3 w-3" /> : <Tag className="h-3 w-3" />}
                            {brand.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedAsset.tags.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">
                      Tags
                    </h4>
                    <div className="flex flex-wrap gap-1">
                      {selectedAsset.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              {/* Submit for review (T094) — drafts only */}
              {selectedAsset.status === "draft" && (
                <Button
                  variant="default"
                  onClick={() => handleSubmitForReview(selectedAsset)}
                >
                  <Send className="size-4 mr-1.5" />
                  Submit for review
                </Button>
              )}
              {/* Edit / Fork (T095) — approved only */}
              {selectedAsset.status === "approved" && (
                <Button
                  variant="default"
                  onClick={() => handleFork(selectedAsset)}
                >
                  <GitFork className="size-4 mr-1.5" />
                  Edit / Fork
                </Button>
              )}
              {/* Save as Brew */}
              <Button
                variant="outline"
                onClick={() => {
                  setBrewName("");
                  setBrewDescription("");
                  setBrewIncludePrompt(true);
                  setBrewAsset(selectedAsset);
                }}
              >
                <FlaskConical className="size-4 mr-1.5" />
                Brew
              </Button>
              {/* Use as reference / Animate — image assets only */}
              {selectedAsset.mediaType === "image" && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedAsset(null);
                      router.push(`/generate?imageInput=${encodeURIComponent(selectedAsset.url)}`);
                    }}
                  >
                    <ImagePlus className="size-4 mr-1.5" />
                    Reference
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedAsset(null);
                      handleAnimate(selectedAsset);
                    }}
                  >
                    <Wand2 className="size-4 mr-1.5" />
                    Animate
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                onClick={() => handleDownload(selectedAsset)}
              >
                <Download className="size-4 mr-1.5" />
                Download
              </Button>
              <Button
                variant="destructive"
                onClick={() => setDeleteConfirm(selectedAsset.id)}
              >
                <Trash2 className="size-4 mr-1.5" />
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteConfirm}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Asset</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this asset? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteConfirm(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="size-4 mr-1.5 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save as Brew Dialog */}
      <Dialog open={!!brewAsset} onOpenChange={(open) => { if (!open) setBrewAsset(null); }}>
        {brewAsset ? (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5" />
                Save as Brew
              </DialogTitle>
              <DialogDescription>
                Save this generation&apos;s recipe for quick reuse.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="gallery-brew-name">Name</Label>
                <Input
                  id="gallery-brew-name"
                  value={brewName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBrewName(e.target.value)}
                  placeholder="e.g. Anime Portrait Setup"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gallery-brew-desc">Description (optional)</Label>
                <Textarea
                  id="gallery-brew-desc"
                  value={brewDescription}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBrewDescription(e.target.value)}
                  placeholder="What's this brew for?"
                  rows={2}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="gallery-brew-prompt"
                  checked={brewIncludePrompt}
                  onCheckedChange={setBrewIncludePrompt}
                />
                <Label htmlFor="gallery-brew-prompt" className="text-sm cursor-pointer">
                  Include prompt text
                </Label>
              </div>
              <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 space-y-1.5 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-foreground">{getModelLabel(brewAsset.model)}</span>
                  <Badge variant="outline" className="text-[9px]">{brewAsset.provider}</Badge>
                </div>
                {brewIncludePrompt && brewAsset.prompt ? (
                  <p className="line-clamp-2 italic">&quot;{brewAsset.prompt}&quot;</p>
                ) : (
                  <p className="opacity-60">Config only — no prompt</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setBrewAsset(null)}>Cancel</Button>
              <Button onClick={handleSaveAsBrew} disabled={!brewName.trim() || isSavingBrew}>
                {isSavingBrew ? <Loader2 className="size-4 animate-spin mr-1" /> : null}
                Save Brew
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

// -------------------------------------------------------------------
// Gallery Card
// -------------------------------------------------------------------

function GalleryCard({
  asset,
  onClick,
}: {
  asset: GalleryAsset;
  onClick: () => void;
}) {
  const isVideo = asset.mediaType === "video";

  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-lg bg-muted text-left cursor-pointer transition-all hover:ring-2 hover:ring-ring/50 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="aspect-square relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.thumbnailUrl}
          alt={asset.prompt}
          className="h-full w-full object-cover"
          loading="lazy"
        />

        {/* Brand tags — always visible */}
        {asset.brands.length > 0 && (
          <div className="absolute top-2 left-2 flex flex-wrap gap-1 z-10">
            {asset.brands.map((brand) => (
              <span
                key={brand.id}
                className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold backdrop-blur-sm border"
                style={{
                  backgroundColor: `${brand.color}40`,
                  borderColor: `${brand.color}60`,
                  color: "white",
                }}
              >
                {brand.name}
              </span>
            ))}
          </div>
        )}

        {/* Video overlay indicators */}
        {isVideo && (
          <>
            {/* Play icon */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm transition-transform group-hover:scale-110">
                <Play className="size-5 text-white fill-white ml-0.5" />
              </div>
            </div>

            {/* Duration badge */}
            {asset.duration && (
              <div className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums backdrop-blur-sm">
                {asset.duration}s
              </div>
            )}

            {/* Audio indicator */}
            {asset.hasAudio && (
              <div className="absolute top-2 right-2">
                <Volume2 className="size-3.5 text-white drop-shadow-md" />
              </div>
            )}
          </>
        )}

        {/* Hover Overlay */}
        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/20 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
          <p className="line-clamp-2 text-xs text-white/90 leading-relaxed">
            {asset.prompt}
          </p>
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1 flex-wrap min-w-0">
              <Badge
                variant="secondary"
                className="text-[10px] bg-white/20 text-white border-0"
              >
                {getModelLabel(asset.model)}
              </Badge>
              {asset.brands.map((brand) => (
                <span
                  key={brand.id}
                  className="rounded-full px-1.5 py-0.5 text-[9px] font-medium border"
                  style={{
                    backgroundColor: `${brand.color}30`,
                    borderColor: `${brand.color}50`,
                    color: brand.color,
                  }}
                >
                  {brand.name}
                </span>
              ))}
            </div>
            <Avatar className="h-5 w-5 shrink-0 ml-2 ring-1 ring-white/30">
              <AvatarImage src={asset.user.image ?? undefined} />
              <AvatarFallback className="text-[8px] bg-white/20 text-white">
                {asset.user.name?.charAt(0)?.toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
          </div>
        </div>
      </div>
    </button>
  );
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function getModelLabel(model: string): string {
  const labels: Record<string, string> = {
    "imagen-4": "Imagen 4",
    "imagen-flash": "Imagen Flash",
    "imagen-flash-lite": "Imagen Lite",
    "grok-imagine": "Grok Imagine",
    "grok-imagine-pro": "Grok Pro",
    "flux-1.1-pro": "Flux Pro",
    "flux-dev": "Flux Dev",
    "ideogram-3": "Ideogram 3",
    "recraft-v3": "Recraft V3",
    "recraft-20b": "Recraft 20B",
    "veo-3": "Veo 3",
    "runway-gen4-turbo": "Gen-4 Turbo",
    "kling-2.1": "Kling 2.1",
    "hailuo-2.3": "Hailuo 2.3",
    "ray-2": "Ray 2",
  };
  return labels[model] ?? model;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
