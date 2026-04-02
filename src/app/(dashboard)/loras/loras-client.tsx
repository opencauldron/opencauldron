"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
} from "@/components/ui/dialog";
import {
  Search,
  Heart,
  Download,
  Loader2,
  AlertCircle,
  Layers,
  ExternalLink,
  ThumbsUp,
  FileType,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import type { CivitaiModel, LoraSource } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FavoriteLora {
  id: string;
  source?: LoraSource;
  civitaiModelId?: number;
  civitaiVersionId?: number;
  hfRepoId?: string;
  name: string;
  downloadUrl: string;
  triggerWords: string[];
  previewImageUrl: string | null;
  createdAt: string;
}

interface HfSearchResult {
  id: string;
  author: string;
  name: string;
  downloads: number;
  likes: number;
  tags: string[];
  previewImageUrl: string | null;
  triggerWords: string[];
  downloadUrl: string | null;
  safetensorsFiles: string[];
}

type SortOption = "Most Downloaded" | "Highest Rated" | "Newest";
type ViewFilter = "all" | "favorites";

interface BaseModelOption {
  value: string;
  label: string;
  canGenerate: boolean;
  hfFilter?: string;
}

const BASE_MODELS: BaseModelOption[] = [
  { value: "Flux.1 D", label: "Flux", canGenerate: true, hfFilter: "base_model:adapter:black-forest-labs/FLUX.1-dev" },
  { value: "SDXL 1.0", label: "SDXL", canGenerate: false, hfFilter: "base_model:adapter:stabilityai/stable-diffusion-xl-base-1.0" },
  { value: "Pony", label: "Pony", canGenerate: false },
  { value: "Illustrious", label: "Illustrious", canGenerate: false },
  { value: "SD 1.5", label: "SD 1.5", canGenerate: false, hfFilter: "base_model:adapter:runwayml/stable-diffusion-v1-5" },
  { value: "Hunyuan Video", label: "Hunyuan Video", canGenerate: false },
  { value: "Wan Video", label: "Wan Video", canGenerate: false },
];

const SEARCH_DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LorasClient() {
  // Source state
  const [source, setSource] = useState<LoraSource>("civitai");

  // Search / filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<SortOption>("Most Downloaded");
  const [baseModel, setBaseModel] = useState<string>("Flux.1 D");
  const [nsfwEnabled, setNsfwEnabled] = useState(false);
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");

  // Filter base models based on source
  const availableBaseModels = useMemo(() => {
    if (source === "huggingface") {
      return BASE_MODELS.filter((b) => b.hfFilter);
    }
    return BASE_MODELS;
  }, [source]);

  const activeBaseModel = BASE_MODELS.find((b) => b.value === baseModel);

  // When source changes to HF, ensure baseModel has an hfFilter
  useEffect(() => {
    if (source === "huggingface") {
      const current = BASE_MODELS.find((b) => b.value === baseModel);
      if (!current?.hfFilter) {
        const first = BASE_MODELS.find((b) => b.hfFilter);
        if (first) setBaseModel(first.value);
      }
    }
  }, [source, baseModel]);

  // Civitai results state
  const [results, setResults] = useState<CivitaiModel[]>([]);
  // HF results state
  const [hfResults, setHfResults] = useState<HfSearchResult[]>([]);

  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Favorites state
  const [favorites, setFavorites] = useState<FavoriteLora[]>([]);
  const [isFavoritesLoaded, setIsFavoritesLoaded] = useState(false);
  const [favoritingIds, setFavoritingIds] = useState<Set<number>>(new Set());
  const [favoritingHfIds, setFavoritingHfIds] = useState<Set<string>>(new Set());

  // Detail sheet
  const [selectedModel, setSelectedModel] = useState<CivitaiModel | null>(null);
  const [selectedHfModel, setSelectedHfModel] = useState<HfSearchResult | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeImageIdx, setActiveImageIdx] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -----------------------------------------------------------------------
  // Debounced search
  // -----------------------------------------------------------------------

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(value);
    }, SEARCH_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
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

  // Reset results when source changes
  useEffect(() => {
    setResults([]);
    setHfResults([]);
    setCursor(null);
    setSearchError(null);
  }, [source]);

  // -----------------------------------------------------------------------
  // Fetch search results
  // -----------------------------------------------------------------------

  const fetchSearch = useCallback(
    async (query: string, nsfw: boolean, sortBy: string, base: string, nextCursor?: string) => {
      if (source === "huggingface") {
        const params = new URLSearchParams();
        if (query) params.set("query", query);
        const hfSort = sortBy === "Most Downloaded" ? "downloads" : sortBy === "Highest Rated" ? "likes" : "lastModified";
        params.set("sort", hfSort);
        params.set("baseModel", base);
        if (nextCursor) params.set("cursor", nextCursor);

        const res = await fetch(`/api/huggingface/search?${params.toString()}`);
        if (!res.ok) throw new Error("Search failed");
        return res.json();
      }

      const params = new URLSearchParams();
      if (query) params.set("query", query);
      params.set("nsfw", String(nsfw));
      params.set("sort", sortBy);
      params.set("baseModel", base);
      if (nextCursor) params.set("cursor", nextCursor);

      const res = await fetch(`/api/civitai/search?${params.toString()}`);
      if (!res.ok) throw new Error("Search failed");
      return res.json() as Promise<{
        items: CivitaiModel[];
        metadata?: { nextCursor?: string };
      }>;
    },
    [source]
  );

  // Initial load: fetch search + favorites in parallel
  useEffect(() => {
    let cancelled = false;
    setIsSearching(true);
    setSearchError(null);

    const searchPromise = fetchSearch(debouncedQuery, nsfwEnabled, sort, baseModel);
    const favPromise = !isFavoritesLoaded
      ? fetch("/api/lora-favorites").then((r) => (r.ok ? r.json() : { favorites: [] }))
      : Promise.resolve(null);

    Promise.all([searchPromise, favPromise])
      .then(([searchData, favData]) => {
        if (cancelled) return;
        if (source === "huggingface") {
          setHfResults(searchData.items ?? []);
          setCursor(searchData.nextCursor ?? null);
        } else {
          setResults(searchData.items ?? []);
          setCursor(searchData.metadata?.nextCursor ?? null);
        }
        if (favData) {
          setFavorites(favData.favorites ?? []);
          setIsFavoritesLoaded(true);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setSearchError(err instanceof Error ? err.message : "Search failed");
        setResults([]);
        setHfResults([]);
      })
      .finally(() => {
        if (!cancelled) setIsSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, nsfwEnabled, sort, baseModel, fetchSearch, isFavoritesLoaded, source]);

  // -----------------------------------------------------------------------
  // Load more
  // -----------------------------------------------------------------------

  const handleLoadMore = useCallback(async () => {
    if (!cursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const data = await fetchSearch(debouncedQuery, nsfwEnabled, sort, baseModel, cursor);
      if (source === "huggingface") {
        setHfResults((prev) => [...prev, ...(data.items ?? [])]);
        setCursor(data.nextCursor ?? null);
      } else {
        setResults((prev) => [...prev, ...(data.items ?? [])]);
        setCursor(data.metadata?.nextCursor ?? null);
      }
    } catch {
      // Silent
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor, isLoadingMore, fetchSearch, debouncedQuery, nsfwEnabled, sort, baseModel, source]);

  // -----------------------------------------------------------------------
  // Favorites
  // -----------------------------------------------------------------------

  const favoriteKeys = useMemo(
    () => new Set(favorites.map((f) => {
      const s = f.source ?? "civitai";
      return s === "civitai" ? `civitai:${f.civitaiVersionId}` : `hf:${f.hfRepoId}`;
    })),
    [favorites]
  );

  const favoriteVersionIds = useMemo(
    () => new Set(favorites.filter((f) => (f.source ?? "civitai") === "civitai").map((f) => f.civitaiVersionId!)),
    [favorites]
  );

  const toggleFavorite = useCallback(
    async (model: CivitaiModel) => {
      const version = model.modelVersions?.[0];
      if (!version) return;

      const existing = favorites.find((f) => (f.source ?? "civitai") === "civitai" && f.civitaiVersionId === version.id);
      setFavoritingIds((prev) => new Set(prev).add(version.id));

      try {
        if (existing) {
          const res = await fetch(`/api/lora-favorites?id=${existing.id}`, { method: "DELETE" });
          if (res.ok) {
            setFavorites((prev) => prev.filter((f) => f.id !== existing.id));
            toast.success("Removed from favorites");
          } else {
            toast.error("Failed to remove favorite");
          }
        } else {
          const file =
            version.files?.find((f) => f.metadata?.format === "SafeTensor") ??
            version.files?.[0];
          const previewImage = version.images?.[0];

          const res = await fetch("/api/lora-favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source: "civitai",
              civitaiModelId: model.id,
              civitaiVersionId: version.id,
              name: model.name,
              downloadUrl: file?.downloadUrl ?? "",
              triggerWords: version.trainedWords ?? [],
              previewImageUrl: previewImage?.url,
            }),
          });

          if (res.ok) {
            const data = (await res.json()) as { favorite: FavoriteLora };
            setFavorites((prev) => [data.favorite, ...prev]);
            toast.success("Added to favorites");
          } else {
            const err = await res.json().catch(() => ({ error: "Unknown error" }));
            toast.error((err as { error?: string }).error ?? "Failed to favorite");
          }
        }
      } catch (e) {
        toast.error("Failed to update favorite");
      } finally {
        setFavoritingIds((prev) => {
          const next = new Set(prev);
          next.delete(version.id);
          return next;
        });
      }
    },
    [favorites]
  );

  const toggleHfFavorite = useCallback(
    async (model: HfSearchResult) => {
      const existing = favorites.find((f) => f.source === "huggingface" && f.hfRepoId === model.id);
      setFavoritingHfIds((prev) => new Set(prev).add(model.id));

      try {
        if (existing) {
          const res = await fetch(`/api/lora-favorites?id=${existing.id}`, { method: "DELETE" });
          if (res.ok) {
            setFavorites((prev) => prev.filter((f) => f.id !== existing.id));
            toast.success("Removed from favorites");
          }
        } else {
          if (!model.downloadUrl) {
            toast.error("No safetensors file found for this LoRA");
            return;
          }
          const res = await fetch("/api/lora-favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source: "huggingface",
              hfRepoId: model.id,
              name: model.name,
              downloadUrl: model.downloadUrl,
              triggerWords: model.triggerWords,
              previewImageUrl: model.previewImageUrl,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            setFavorites((prev) => [data.favorite, ...prev]);
            toast.success("Added to favorites");
          }
        }
      } catch {
        toast.error("Failed to update favorite");
      } finally {
        setFavoritingHfIds((prev) => {
          const next = new Set(prev);
          next.delete(model.id);
          return next;
        });
      }
    },
    [favorites]
  );

  // -----------------------------------------------------------------------
  // Display list — all or favorites only
  // -----------------------------------------------------------------------

  const displayResults = useMemo(() => {
    if (viewFilter === "favorites") {
      return results.filter((m) => {
        const v = m.modelVersions?.[0];
        return v ? favoriteVersionIds.has(v.id) : false;
      });
    }
    return results;
  }, [viewFilter, results, favoriteVersionIds]);

  const displayHfResults = useMemo(() => {
    if (viewFilter === "favorites") {
      return hfResults.filter((m) => favoriteKeys.has(`hf:${m.id}`));
    }
    return hfResults;
  }, [viewFilter, hfResults, favoriteKeys]);

  // -----------------------------------------------------------------------
  // Open detail
  // -----------------------------------------------------------------------

  const openDetail = useCallback((model: CivitaiModel) => {
    setSelectedModel(model);
    setSelectedHfModel(null);
    setActiveImageIdx(0);
    setDetailOpen(true);
  }, []);

  const openHfDetail = useCallback((model: HfSearchResult) => {
    setSelectedHfModel(model);
    setSelectedModel(null);
    setActiveImageIdx(0);
    setDetailOpen(true);
  }, []);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const currentResults = source === "huggingface" ? displayHfResults : displayResults;
  const hasResults = currentResults.length > 0;

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Source selector */}
        <div className="flex items-center gap-1 rounded-lg bg-secondary/50 p-0.5">
          <Button
            variant={source === "civitai" ? "default" : "ghost"}
            size="sm"
            className="h-7 text-xs px-3 cursor-pointer"
            onClick={() => setSource("civitai")}
          >
            Civitai
          </Button>
          <Button
            variant={source === "huggingface" ? "default" : "ghost"}
            size="sm"
            className="h-7 text-xs px-3 cursor-pointer"
            onClick={() => setSource("huggingface")}
          >
            HuggingFace
          </Button>
        </div>

        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={source === "huggingface" ? "Search LoRAs on HuggingFace..." : "Search LoRAs on Civitai..."}
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9 bg-secondary/50 border-border/50"
          />
        </div>

        {/* Base model */}
        <Select value={baseModel} onValueChange={(v) => { if (v) setBaseModel(v); }}>
          <SelectTrigger className="w-[160px] bg-secondary/50 border-border/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableBaseModels.map((bm) => (
              <SelectItem key={bm.value} value={bm.value}>
                <span className="flex items-center gap-2">
                  {bm.label}
                  {bm.canGenerate ? (
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
                  ) : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Sort */}
        <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
          <SelectTrigger className="w-[170px] bg-secondary/50 border-border/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Most Downloaded">Most Downloaded</SelectItem>
            <SelectItem value="Highest Rated">Highest Rated</SelectItem>
            <SelectItem value="Newest">Newest</SelectItem>
          </SelectContent>
        </Select>

        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Button
              variant={viewFilter === "all" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewFilter("all")}
              className="h-8 text-xs cursor-pointer"
            >
              All
            </Button>
            <Button
              variant={viewFilter === "favorites" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewFilter("favorites")}
              className="h-8 text-xs gap-1 cursor-pointer"
            >
              <Heart className="h-3 w-3" />
              Favorites
              {favorites.length > 0 ? (
                <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[9px]">
                  {favorites.length}
                </Badge>
              ) : null}
            </Button>
          </div>

          {source === "civitai" ? (
            <div className="flex items-center gap-1.5">
              <Label htmlFor="nsfw-page" className="text-xs text-muted-foreground cursor-pointer">
                NSFW
              </Label>
              <Switch
                id="nsfw-page"
                checked={nsfwEnabled}
                onCheckedChange={setNsfwEnabled}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* Results grid */}
      {searchError ? (
        <div className="flex items-center gap-2 text-sm text-destructive py-12 justify-center">
          <AlertCircle className="h-4 w-4" />
          {searchError}
        </div>
      ) : isSearching ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-[3/4] rounded-lg" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : !hasResults ? (
        <div className="text-center py-16 space-y-2">
          {viewFilter === "favorites" ? (
            <>
              <Heart className="h-8 w-8 mx-auto text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No favorites yet</p>
              <p className="text-xs text-muted-foreground/60">
                Browse LoRAs and click the heart icon to save them here
              </p>
            </>
          ) : (
            <>
              <Layers className="h-8 w-8 mx-auto text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                {debouncedQuery ? "No LoRAs found" : "Search for LoRAs to get started"}
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {source === "huggingface"
              ? displayHfResults.map((model, idx) => {
                  const isFaved = favoriteKeys.has(`hf:${model.id}`);
                  const isFaving = favoritingHfIds.has(model.id);

                  return (
                    <div
                      key={`${model.id}-${idx}`}
                      className="group relative rounded-xl border border-border/40 bg-card overflow-hidden transition-all duration-200 hover:border-border hover:shadow-md cursor-pointer"
                      onClick={() => openHfDetail(model)}
                    >
                      {/* Preview */}
                      <div className="aspect-[3/4] bg-muted/20 overflow-hidden">
                        <LoraImage src={model.previewImageUrl} />
                      </div>

                      {/* Favorite button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleHfFavorite(model);
                        }}
                        disabled={isFaving}
                        className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm text-white transition-all hover:bg-black/60 hover:scale-110 cursor-pointer"
                      >
                        <Heart
                          className={`h-4 w-4 transition-colors ${isFaved ? "fill-red-400 text-red-400" : ""}`}
                        />
                      </button>

                      {/* Info */}
                      <div className="p-3 space-y-1.5">
                        <h3 className="text-sm font-medium leading-tight line-clamp-2">
                          {model.name}
                        </h3>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="truncate">{model.author}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
                          <span className="flex items-center gap-1">
                            <Download className="h-3 w-3" />
                            {formatCount(model.downloads)}
                          </span>
                          <span className="flex items-center gap-1">
                            <ThumbsUp className="h-3 w-3" />
                            {formatCount(model.likes)}
                          </span>
                        </div>
                        {activeBaseModel?.canGenerate ? (
                          <Badge variant="secondary" className="text-[9px] w-fit gap-1 font-normal">
                            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                            Ready to generate
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] w-fit gap-1 font-normal text-muted-foreground">
                            Browse only
                          </Badge>
                        )}
                        {model.tags?.length ? (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {model.tags.slice(0, 3).map((tag) => (
                              <Badge
                                key={tag}
                                variant="outline"
                                className="text-[9px] h-4 px-1.5 font-normal"
                              >
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              : displayResults.map((model, idx) => {
                  const version = model.modelVersions?.[0];
                  const preview = version?.images?.[0];
                  const isFaved = version ? favoriteVersionIds.has(version.id) : false;
                  const isFaving = version ? favoritingIds.has(version.id) : false;

                  return (
                    <div
                      key={`${model.id}-${idx}`}
                      className="group relative rounded-xl border border-border/40 bg-card overflow-hidden transition-all duration-200 hover:border-border hover:shadow-md cursor-pointer"
                      onClick={() => openDetail(model)}
                    >
                      {/* Preview */}
                      <div className="aspect-[3/4] bg-muted/20 overflow-hidden">
                        <LoraImage src={preview?.url} type={preview?.type} />
                      </div>

                      {/* Favorite button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(model);
                        }}
                        disabled={isFaving}
                        className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm text-white transition-all hover:bg-black/60 hover:scale-110 cursor-pointer"
                      >
                        <Heart
                          className={`h-4 w-4 transition-colors ${isFaved ? "fill-red-400 text-red-400" : ""}`}
                        />
                      </button>

                      {/* Info */}
                      <div className="p-3 space-y-1.5">
                        <h3 className="text-sm font-medium leading-tight line-clamp-2">
                          {model.name}
                        </h3>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {model.creator?.image ? (
                            <img
                              src={model.creator.image}
                              alt=""
                              className="h-4 w-4 rounded-full"
                            />
                          ) : null}
                          <span className="truncate">{model.creator?.username}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
                          <span className="flex items-center gap-1">
                            <Download className="h-3 w-3" />
                            {formatCount(model.stats?.downloadCount ?? 0)}
                          </span>
                          <span className="flex items-center gap-1">
                            <ThumbsUp className="h-3 w-3" />
                            {formatCount(model.stats?.thumbsUpCount ?? 0)}
                          </span>
                        </div>
                        {activeBaseModel?.canGenerate ? (
                          <Badge variant="secondary" className="text-[9px] w-fit gap-1 font-normal">
                            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                            Ready to generate
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] w-fit gap-1 font-normal text-muted-foreground">
                            Browse only
                          </Badge>
                        )}
                        {model.tags?.length ? (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {model.tags.slice(0, 3).map((tag) => (
                              <Badge
                                key={tag}
                                variant="outline"
                                className="text-[9px] h-4 px-1.5 font-normal"
                              >
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
          </div>

          {/* Load more */}
          {cursor && viewFilter === "all" ? (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="gap-2"
              >
                {isLoadingMore ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        {selectedModel ? (
          <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
            <LoraDetailPanel
              model={selectedModel}
              isFaved={
                selectedModel.modelVersions?.[0]
                  ? favoriteVersionIds.has(selectedModel.modelVersions[0].id)
                  : false
              }
              onToggleFavorite={() => toggleFavorite(selectedModel)}
              activeImageIdx={activeImageIdx}
              onImageIdxChange={setActiveImageIdx}
            />
          </DialogContent>
        ) : selectedHfModel ? (
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <HfLoraDetailPanel
              model={selectedHfModel}
              isFaved={favoriteKeys.has(`hf:${selectedHfModel.id}`)}
              onToggleFavorite={() => toggleHfFavorite(selectedHfModel)}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HuggingFace Detail Panel
// ---------------------------------------------------------------------------

function HfLoraDetailPanel({
  model,
  isFaved,
  onToggleFavorite,
}: {
  model: HfSearchResult;
  isFaved: boolean;
  onToggleFavorite: () => void;
}) {
  return (
    <>
      <DialogHeader className="sr-only">
        <DialogTitle>{model.name}</DialogTitle>
        <DialogDescription>HuggingFace LoRA details</DialogDescription>
      </DialogHeader>

      <div className="grid md:grid-cols-[1fr_300px] gap-6">
        {/* Left column -- preview */}
        <div className="space-y-2 min-w-0">
          {model.previewImageUrl ? (
            <div className="relative aspect-square rounded-lg overflow-hidden bg-muted/20">
              <img
                src={model.previewImageUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div className="aspect-square rounded-lg bg-muted/20 flex items-center justify-center">
              <Layers className="h-16 w-16 text-muted-foreground/15" />
            </div>
          )}
        </div>

        {/* Right column -- metadata */}
        <div className="space-y-4 min-w-0 overflow-y-auto max-h-[70vh]">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold leading-tight">{model.name}</h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{model.author}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              variant={isFaved ? "secondary" : "default"}
              className="flex-1 gap-2 cursor-pointer"
              onClick={onToggleFavorite}
            >
              <Heart className={`h-4 w-4 ${isFaved ? "fill-red-400 text-red-400" : ""}`} />
              {isFaved ? "Favorited" : "Favorite"}
            </Button>
            <Button
              variant="outline"
              className="gap-2 cursor-pointer"
              onClick={() => window.open(`https://huggingface.co/${model.id}`, "_blank")}
            >
              <ExternalLink className="h-4 w-4" />
              HuggingFace
            </Button>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2">
            <StatCard icon={Download} label="Downloads" value={formatCount(model.downloads)} />
            <StatCard icon={ThumbsUp} label="Likes" value={formatCount(model.likes)} />
          </div>

          {/* Trigger words */}
          {model.triggerWords.length > 0 ? (
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Trigger Words
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {model.triggerWords.map((word) => (
                  <Badge key={word} variant="secondary" className="text-xs font-mono">
                    {word}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {/* Tags */}
          {model.tags?.length ? (
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Tags
              </h4>
              <div className="flex flex-wrap gap-1">
                {model.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px] font-normal">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {/* Safetensors files */}
          {model.safetensorsFiles.length > 0 ? (
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Model Files
              </h4>
              <div className="space-y-1">
                {model.safetensorsFiles.map((file) => (
                  <div key={file} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <FileType className="h-3 w-3 shrink-0" />
                    <span className="truncate font-mono">{file}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Detail Panel — two-column layout: images left, metadata right
// ---------------------------------------------------------------------------

function LoraDetailPanel({
  model,
  isFaved,
  onToggleFavorite,
  activeImageIdx,
  onImageIdxChange,
}: {
  model: CivitaiModel;
  isFaved: boolean;
  onToggleFavorite: () => void;
  activeImageIdx: number;
  onImageIdxChange: (idx: number) => void;
}) {
  const version = model.modelVersions?.[0];
  const images = version?.images ?? [];
  const file =
    version?.files?.find((f) => f.metadata?.format === "SafeTensor") ??
    version?.files?.[0];
  const activeImage = images[activeImageIdx];
  const publishedDate = version?.publishedAt
    ? new Date(version.publishedAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <>
      <DialogHeader className="sr-only">
        <DialogTitle>{model.name}</DialogTitle>
        <DialogDescription>LoRA details</DialogDescription>
      </DialogHeader>

      <div className="grid md:grid-cols-[1fr_340px] gap-6">
        {/* Left column — image gallery */}
        <div className="space-y-2 min-w-0">
          {images.length > 0 ? (
            <>
              <div className="relative aspect-square rounded-lg overflow-hidden bg-muted/20">
                {activeImage?.type === "video" ? (
                  <video
                    src={activeImage.url}
                    muted
                    loop
                    autoPlay
                    playsInline
                    controls
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <img
                    src={activeImage?.url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
                {images.length > 1 ? (
                  <>
                    <button
                      onClick={() =>
                        onImageIdxChange(
                          (activeImageIdx - 1 + images.length) % images.length
                        )
                      }
                      className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition-colors cursor-pointer"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() =>
                        onImageIdxChange((activeImageIdx + 1) % images.length)
                      }
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition-colors cursor-pointer"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-sm rounded-full px-2.5 py-0.5 text-[11px] text-white tabular-nums">
                      {activeImageIdx + 1} / {images.length}
                    </div>
                  </>
                ) : null}
              </div>

              {/* Thumbnail strip */}
              {images.length > 1 ? (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {images.slice(0, 10).map((img, idx) => (
                    <button
                      key={idx}
                      onClick={() => onImageIdxChange(idx)}
                      className={`shrink-0 h-14 w-14 rounded-md overflow-hidden border-2 transition-all cursor-pointer ${
                        idx === activeImageIdx
                          ? "border-primary ring-1 ring-primary/30"
                          : "border-transparent opacity-50 hover:opacity-100"
                      }`}
                    >
                      <img src={img.url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="aspect-square rounded-lg bg-muted/20 flex items-center justify-center">
              <Layers className="h-16 w-16 text-muted-foreground/15" />
            </div>
          )}
        </div>

        {/* Right column — metadata */}
        <div className="space-y-4 min-w-0 overflow-y-auto max-h-[70vh]">
          {/* Title + creator */}
          <div className="space-y-2">
            <h2 className="text-xl font-semibold leading-tight">{model.name}</h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {model.creator?.image ? (
                <img src={model.creator.image} alt="" className="h-5 w-5 rounded-full" />
              ) : null}
              <span>{model.creator?.username}</span>
              {publishedDate ? (
                <>
                  <span className="opacity-30">·</span>
                  <span className="text-xs">{publishedDate}</span>
                </>
              ) : null}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              variant={isFaved ? "secondary" : "default"}
              className="flex-1 gap-2 cursor-pointer"
              onClick={onToggleFavorite}
            >
              <Heart className={`h-4 w-4 ${isFaved ? "fill-red-400 text-red-400" : ""}`} />
              {isFaved ? "Favorited" : "Favorite"}
            </Button>
            <Button
              variant="outline"
              className="gap-2 cursor-pointer"
              onClick={() => window.open(`https://civitai.com/models/${model.id}`, "_blank")}
            >
              <ExternalLink className="h-4 w-4" />
              Civitai
            </Button>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2">
            <StatCard icon={Download} label="Downloads" value={formatCount(model.stats?.downloadCount ?? 0)} />
            <StatCard icon={ThumbsUp} label="Likes" value={formatCount(model.stats?.thumbsUpCount ?? 0)} />
            <StatCard icon={Layers} label="Base Model" value={version?.baseModel ?? "Unknown"} />
            {file ? (
              <StatCard icon={FileType} label="File" value={`${file.metadata?.format ?? "?"} · ${(file.sizeKB / 1024).toFixed(0)} MB`} />
            ) : null}
          </div>

          {/* Trigger words */}
          {version?.trainedWords && version.trainedWords.length > 0 ? (
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Trigger Words
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {version.trainedWords.map((word) => (
                  <Badge key={word} variant="secondary" className="text-xs font-mono">
                    {word}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {/* Tags */}
          {model.tags?.length ? (
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Tags
              </h4>
              <div className="flex flex-wrap gap-1">
                {model.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px] font-normal">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Stat card for detail panel
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border/40 bg-secondary/20 px-3 py-2 space-y-0.5">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <p className="text-sm font-medium truncate">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image with fallback
// ---------------------------------------------------------------------------

function LoraImage({ src, type }: { src?: string | null; type?: "image" | "video" }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <Layers className="h-10 w-10 text-muted-foreground/20" />
      </div>
    );
  }

  if (type === "video") {
    return (
      <video
        src={src}
        muted
        loop
        autoPlay
        playsInline
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
      onError={() => setFailed(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

