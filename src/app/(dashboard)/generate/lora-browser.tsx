"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Layers,
  Search,
  Heart,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  Download,
  Check,
  Loader2,
  AlertCircle,
} from "lucide-react";
import type { CivitaiModel, SelectedLora, LoraSource } from "@/types";
import { getLoraUniqueKey } from "@/lib/lora-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoraBrowserProps {
  selectedLoras: SelectedLora[];
  onLorasChange: (loras: SelectedLora[]) => void;
  onTriggerWordsChange: (words: string[]) => void;
  nsfwEnabled: boolean;
  onNsfwChange: (enabled: boolean) => void;
  baseModel?: string;
}

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

const MAX_LORAS = 5;
const SEARCH_DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LoraBrowser({
  selectedLoras,
  onLorasChange,
  onTriggerWordsChange,
  nsfwEnabled,
  onNsfwChange,
  baseModel,
}: LoraBrowserProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"browse" | "favorites">("browse");
  const [browseSource, setBrowseSource] = useState<LoraSource>("civitai");

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CivitaiModel[]>([]);
  const [hfSearchResults, setHfSearchResults] = useState<HfSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Favorites state
  const [favorites, setFavorites] = useState<FavoriteLora[]>([]);
  const [isFavoritesLoaded, setIsFavoritesLoaded] = useState(false);
  const [favoritingIds, setFavoritingIds] = useState<Set<number>>(new Set());

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAtLimit = selectedLoras.length >= MAX_LORAS;

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

  // Reset results when source changes
  useEffect(() => {
    setSearchResults([]);
    setHfSearchResults([]);
    setCursor(null);
    setSearchError(null);
  }, [browseSource]);

  // -----------------------------------------------------------------------
  // Fetch search results
  // -----------------------------------------------------------------------

  const fetchSearch = useCallback(
    async (query: string, nsfw: boolean, nextCursor?: string) => {
      if (browseSource === "huggingface") {
        const params = new URLSearchParams();
        if (query) params.set("query", query);
        params.set("sort", "downloads");
        if (baseModel) params.set("baseModel", baseModel);
        if (nextCursor) params.set("cursor", nextCursor);

        const res = await fetch(`/api/huggingface/search?${params.toString()}`);
        if (!res.ok) throw new Error("Search failed");
        return res.json();
      }

      const params = new URLSearchParams();
      if (query) params.set("query", query);
      params.set("nsfw", String(nsfw));
      if (nextCursor) params.set("cursor", nextCursor);
      if (baseModel) params.set("baseModel", baseModel);

      const res = await fetch(`/api/civitai/search?${params.toString()}`);
      if (!res.ok) throw new Error("Search failed");
      return res.json() as Promise<{
        items: CivitaiModel[];
        metadata?: { nextCursor?: string };
      }>;
    },
    [baseModel, browseSource]
  );

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setIsSearching(true);
    setSearchError(null);

    fetchSearch(debouncedQuery, nsfwEnabled)
      .then((data) => {
        if (cancelled) return;
        if (browseSource === "huggingface") {
          setHfSearchResults(data.items ?? []);
          setCursor(data.nextCursor ?? null);
        } else {
          setSearchResults(data.items ?? []);
          setCursor(data.metadata?.nextCursor ?? null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setSearchError(err instanceof Error ? err.message : "Search failed");
        setSearchResults([]);
        setHfSearchResults([]);
      })
      .finally(() => {
        if (!cancelled) setIsSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, nsfwEnabled, isOpen, fetchSearch, browseSource]);

  // -----------------------------------------------------------------------
  // Load more
  // -----------------------------------------------------------------------

  const handleLoadMore = useCallback(async () => {
    if (!cursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const data = await fetchSearch(debouncedQuery, nsfwEnabled, cursor);
      if (browseSource === "huggingface") {
        setHfSearchResults((prev) => [...prev, ...(data.items ?? [])]);
        setCursor(data.nextCursor ?? null);
      } else {
        setSearchResults((prev) => [...prev, ...(data.items ?? [])]);
        setCursor(data.metadata?.nextCursor ?? null);
      }
    } catch {
      // Silent — user can retry
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor, isLoadingMore, fetchSearch, debouncedQuery, nsfwEnabled, browseSource]);

  // -----------------------------------------------------------------------
  // Fetch favorites
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!isOpen || isFavoritesLoaded) return;

    fetch("/api/lora-favorites")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { favorites: FavoriteLora[] }) => {
        setFavorites(data.favorites ?? []);
        setIsFavoritesLoaded(true);
      })
      .catch(() => {
        setIsFavoritesLoaded(true);
      });
  }, [isOpen, isFavoritesLoaded]);

  // -----------------------------------------------------------------------
  // Key-based deduplication
  // -----------------------------------------------------------------------

  const selectedKeys = useMemo(
    () => new Set(selectedLoras.map((l) => getLoraUniqueKey(l))),
    [selectedLoras]
  );

  const favoriteVersionIds = useMemo(
    () => new Set(favorites.filter((f) => (f.source ?? "civitai") === "civitai").map((f) => f.civitaiVersionId!)),
    [favorites]
  );

  const favoriteKeys = useMemo(
    () => new Set(favorites.map((f) => {
      const s = f.source ?? "civitai";
      return s === "civitai" ? `civitai:${f.civitaiVersionId}` : `hf:${f.hfRepoId}`;
    })),
    [favorites]
  );

  // -----------------------------------------------------------------------
  // Add / remove LoRA
  // -----------------------------------------------------------------------

  const addLora = useCallback(
    (lora: SelectedLora) => {
      if (isAtLimit || selectedKeys.has(getLoraUniqueKey(lora))) return;
      const next = [...selectedLoras, lora];
      onLorasChange(next);
      const allTriggers = next.flatMap((l) => l.triggerWords);
      onTriggerWordsChange(allTriggers);
    },
    [selectedLoras, isAtLimit, selectedKeys, onLorasChange, onTriggerWordsChange]
  );

  const removeLora = useCallback(
    (key: string) => {
      const next = selectedLoras.filter((l) => getLoraUniqueKey(l) !== key);
      onLorasChange(next);
      onTriggerWordsChange(next.flatMap((l) => l.triggerWords));
    },
    [selectedLoras, onLorasChange, onTriggerWordsChange]
  );

  const updateScale = useCallback(
    (key: string, scale: number) => {
      onLorasChange(
        selectedLoras.map((l) =>
          getLoraUniqueKey(l) === key ? { ...l, scale } : l
        )
      );
    },
    [selectedLoras, onLorasChange]
  );

  // -----------------------------------------------------------------------
  // Add from Civitai model
  // -----------------------------------------------------------------------

  const addFromCivitai = useCallback(
    (model: CivitaiModel) => {
      const version = model.modelVersions?.[0];
      if (!version) return;
      const file = version.files?.find((f) => f.metadata?.format === "SafeTensor") ?? version.files?.[0];
      if (!file) return;

      const previewImage = version.images?.[0];
      addLora({
        source: "civitai",
        civitaiModelId: model.id,
        civitaiVersionId: version.id,
        name: model.name,
        downloadUrl: file.downloadUrl,
        scale: 1.0,
        triggerWords: version.trainedWords ?? [],
        previewImageUrl: previewImage?.url,
      });
    },
    [addLora]
  );

  // -----------------------------------------------------------------------
  // Add from HuggingFace
  // -----------------------------------------------------------------------

  const addFromHuggingFace = useCallback(
    (model: HfSearchResult) => {
      if (!model.downloadUrl) return;
      addLora({
        source: "huggingface",
        hfRepoId: model.id,
        name: model.name,
        downloadUrl: model.downloadUrl,
        scale: 1.0,
        triggerWords: model.triggerWords ?? [],
        previewImageUrl: model.previewImageUrl ?? undefined,
      });
    },
    [addLora]
  );

  // -----------------------------------------------------------------------
  // Add from favorite
  // -----------------------------------------------------------------------

  const addFromFavorite = useCallback(
    (fav: FavoriteLora) => {
      const favSource = fav.source ?? "civitai";
      addLora({
        id: fav.id,
        source: favSource,
        civitaiModelId: fav.civitaiModelId,
        civitaiVersionId: fav.civitaiVersionId,
        hfRepoId: fav.hfRepoId,
        name: fav.name,
        downloadUrl: fav.downloadUrl,
        scale: 1.0,
        triggerWords: fav.triggerWords ?? [],
        previewImageUrl: fav.previewImageUrl ?? undefined,
      });
    },
    [addLora]
  );

  // -----------------------------------------------------------------------
  // Toggle favorite
  // -----------------------------------------------------------------------

  const toggleFavorite = useCallback(
    async (model: CivitaiModel) => {
      const version = model.modelVersions?.[0];
      if (!version) return;

      const existing = favorites.find((f) => (f.source ?? "civitai") === "civitai" && f.civitaiVersionId === version.id);
      setFavoritingIds((prev) => new Set(prev).add(version.id));

      try {
        if (existing) {
          await fetch(`/api/lora-favorites?id=${existing.id}`, { method: "DELETE" });
          setFavorites((prev) => prev.filter((f) => f.id !== existing.id));
        } else {
          const file = version.files?.find((f) => f.metadata?.format === "SafeTensor") ?? version.files?.[0];
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
          }
        }
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

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const renderLoraCard = useCallback(
    (
      key: string,
      name: string,
      previewUrl: string | undefined | null,
      downloads: number | null,
      creator: string | null,
      uniqueKey: string,
      onAdd: () => void,
      onToggleFav?: () => void,
      isFaved?: boolean,
      isFaving?: boolean,
    ) => {
      const isSelected = selectedKeys.has(uniqueKey);

      return (
        <div
          key={key}
          className="group relative rounded-lg border border-border/50 bg-card overflow-hidden transition-all hover:border-border hover:shadow-sm"
        >
          {/* Preview image */}
          <div className="aspect-square bg-muted/30 overflow-hidden">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={name}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center">
                <Layers className="h-8 w-8 text-muted-foreground/30" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="p-2.5 space-y-1.5">
            <p className="text-xs font-medium leading-tight line-clamp-2">{name}</p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                {creator ? <span className="truncate max-w-[60px]">{creator}</span> : null}
                {downloads != null ? (
                  <>
                    {creator ? <span className="opacity-40">·</span> : null}
                    <Download className="h-2.5 w-2.5" />
                    <span>{formatCount(downloads)}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="absolute top-1.5 right-1.5 flex gap-1">
            {onToggleFav ? (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleFav(); }}
                disabled={isFaving}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm text-white transition-colors hover:bg-black/70"
              >
                <Heart
                  className={`h-3 w-3 ${isFaved ? "fill-red-400 text-red-400" : ""}`}
                />
              </button>
            ) : null}
          </div>

          {/* Add button overlay */}
          <div className="absolute inset-x-0 bottom-0 p-2 translate-y-full group-hover:translate-y-0 transition-transform duration-200">
            <Button
              size="sm"
              variant={isSelected ? "secondary" : "default"}
              className="w-full h-7 text-xs"
              disabled={isSelected || isAtLimit}
              onClick={onAdd}
            >
              {isSelected ? (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Added
                </>
              ) : isAtLimit ? (
                "Limit reached"
              ) : (
                <>
                  <Plus className="h-3 w-3 mr-1" />
                  Add
                </>
              )}
            </Button>
          </div>
        </div>
      );
    },
    [selectedKeys, isAtLimit]
  );

  // -----------------------------------------------------------------------
  // Main render
  // -----------------------------------------------------------------------

  const currentSearchResults = browseSource === "huggingface" ? hfSearchResults : searchResults;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-2 text-left group"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary">
              <Layers className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
            <CardTitle className="text-sm font-medium group-hover:text-foreground transition-colors">
              LoRA
            </CardTitle>
            {selectedLoras.length > 0 ? (
              <Badge variant="secondary" className="text-[10px] font-mono">
                {selectedLoras.length}/{MAX_LORAS}
              </Badge>
            ) : null}
            {isOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          <Switch checked={isOpen} onCheckedChange={setIsOpen} />
        </div>
      </CardHeader>

      {isOpen ? (
        <CardContent className="space-y-4">
          {/* Tabs: Browse | Favorites */}
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "browse" | "favorites")}
          >
            <div className="flex items-center justify-between gap-3">
              <TabsList className="flex-1">
                <TabsTrigger value="browse" className="flex-1 gap-1.5 text-xs">
                  <Search className="h-3 w-3" />
                  Browse
                </TabsTrigger>
                <TabsTrigger value="favorites" className="flex-1 gap-1.5 text-xs">
                  <Heart className="h-3 w-3" />
                  Favorites
                  {favorites.length > 0 ? (
                    <Badge variant="secondary" className="ml-1 h-4 px-1 text-[9px]">
                      {favorites.length}
                    </Badge>
                  ) : null}
                </TabsTrigger>
              </TabsList>

              {/* NSFW toggle — only for Civitai */}
              {browseSource === "civitai" ? (
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="nsfw-toggle" className="text-[10px] text-muted-foreground cursor-pointer">
                    NSFW
                  </Label>
                  <Switch
                    id="nsfw-toggle"
                    checked={nsfwEnabled}
                    onCheckedChange={onNsfwChange}
                    className="scale-75 origin-right"
                  />
                </div>
              ) : null}
            </div>

            {/* Browse tab */}
            <TabsContent value="browse" className="mt-3 space-y-3">
              {/* Source selector */}
              <div className="flex items-center gap-1 rounded-md bg-secondary/50 p-0.5">
                <Button
                  variant={browseSource === "civitai" ? "default" : "ghost"}
                  size="sm"
                  className="h-6 text-[10px] px-2 cursor-pointer"
                  onClick={() => setBrowseSource("civitai")}
                >
                  Civitai
                </Button>
                <Button
                  variant={browseSource === "huggingface" ? "default" : "ghost"}
                  size="sm"
                  className="h-6 text-[10px] px-2 cursor-pointer"
                  onClick={() => setBrowseSource("huggingface")}
                >
                  HuggingFace
                </Button>
              </div>

              {/* Search input */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder={browseSource === "huggingface" ? "Search HuggingFace LoRAs..." : "Search Civitai LoRAs..."}
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-8 h-8 text-xs bg-secondary/50 border-border/50"
                />
              </div>

              {/* Results */}
              {searchError ? (
                <div className="flex items-center gap-2 text-xs text-destructive py-4 justify-center">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {searchError}
                </div>
              ) : isSearching ? (
                <div className="grid grid-cols-2 gap-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="space-y-2">
                      <Skeleton className="aspect-square rounded-lg" />
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-2.5 w-1/2" />
                    </div>
                  ))}
                </div>
              ) : currentSearchResults.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  {debouncedQuery ? "No LoRAs found" : "Search for LoRAs to get started"}
                </p>
              ) : (
                <>
                  <div className="max-h-[420px] overflow-y-auto">
                    <div className="grid grid-cols-2 gap-2 pr-1">
                      {browseSource === "huggingface"
                        ? hfSearchResults.map((model, idx) => {
                            const uniqueKey = `hf:${model.id}`;
                            return renderLoraCard(
                              `${model.id}-${idx}`,
                              model.name,
                              model.previewImageUrl,
                              model.downloads,
                              model.author,
                              uniqueKey,
                              () => addFromHuggingFace(model),
                              undefined,
                              favoriteKeys.has(uniqueKey),
                              false,
                            );
                          })
                        : searchResults.map((model, idx) => {
                            const version = model.modelVersions?.[0];
                            const preview = version?.images?.[0];
                            const uniqueKey = `civitai:${version?.id ?? 0}`;
                            return renderLoraCard(
                              `${model.id}-${idx}`,
                              model.name,
                              preview?.url,
                              model.stats?.downloadCount,
                              model.creator?.username,
                              uniqueKey,
                              () => addFromCivitai(model),
                              () => toggleFavorite(model),
                              version ? favoriteVersionIds.has(version.id) : false,
                              version ? favoritingIds.has(version.id) : false,
                            );
                          })}
                    </div>
                  </div>

                  {cursor ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs"
                      onClick={handleLoadMore}
                      disabled={isLoadingMore}
                    >
                      {isLoadingMore ? (
                        <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                      ) : null}
                      Load more
                    </Button>
                  ) : null}
                </>
              )}
            </TabsContent>

            {/* Favorites tab */}
            <TabsContent value="favorites" className="mt-3">
              {!isFavoritesLoaded ? (
                <div className="grid grid-cols-2 gap-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="space-y-2">
                      <Skeleton className="aspect-square rounded-lg" />
                      <Skeleton className="h-3 w-3/4" />
                    </div>
                  ))}
                </div>
              ) : favorites.length === 0 ? (
                <div className="text-center py-8 space-y-1.5">
                  <Heart className="h-6 w-6 mx-auto text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground">
                    No favorites yet
                  </p>
                  <p className="text-[10px] text-muted-foreground/60">
                    Heart a LoRA from the Browse tab to save it here
                  </p>
                </div>
              ) : (
                <div className="max-h-[420px] overflow-y-auto">
                  <div className="grid grid-cols-2 gap-2 pr-1">
                    {favorites.map((fav) => {
                      const favSource = fav.source ?? "civitai";
                      const uniqueKey = favSource === "civitai"
                        ? `civitai:${fav.civitaiVersionId}`
                        : `hf:${fav.hfRepoId}`;
                      return renderLoraCard(
                        fav.id,
                        fav.name,
                        fav.previewImageUrl,
                        null,
                        null,
                        uniqueKey,
                        () => addFromFavorite(fav),
                      );
                    })}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>

          {/* Selected LoRAs */}
          {selectedLoras.length > 0 ? (
            <div className="space-y-2.5 pt-2 border-t border-border/50">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">
                  Active LoRAs
                </p>
                <Badge variant="outline" className="text-[10px] font-mono h-5">
                  {selectedLoras.length}/{MAX_LORAS}
                </Badge>
              </div>

              <div className="space-y-2">
                {selectedLoras.map((lora) => {
                  const loraKey = getLoraUniqueKey(lora);
                  return (
                    <div
                      key={loraKey}
                      className="flex gap-2.5 items-start rounded-md border border-border/50 bg-secondary/30 p-2"
                    >
                      {/* Thumbnail */}
                      <div className="h-10 w-10 shrink-0 rounded overflow-hidden bg-muted/50">
                        {lora.previewImageUrl ? (
                          <img
                            src={lora.previewImageUrl}
                            alt={lora.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center">
                            <Layers className="h-4 w-4 text-muted-foreground/40" />
                          </div>
                        )}
                      </div>

                      {/* Details */}
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-xs font-medium truncate">{lora.name}</p>
                          <button
                            onClick={() => removeLora(loraKey)}
                            className="shrink-0 h-5 w-5 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>

                        {/* Scale slider */}
                        <div className="flex items-center gap-2">
                          <Label className="text-[10px] text-muted-foreground shrink-0 w-8">
                            {lora.scale.toFixed(1)}
                          </Label>
                          <input
                            type="range"
                            min={0}
                            max={4}
                            step={0.1}
                            value={lora.scale}
                            onChange={(e) =>
                              updateScale(loraKey, parseFloat(e.target.value))
                            }
                            className="flex-1 h-1 accent-primary cursor-pointer"
                          />
                        </div>

                        {/* Trigger words */}
                        {lora.triggerWords.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {lora.triggerWords.map((word) => (
                              <Tooltip key={word}>
                                <TooltipTrigger>
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] h-4 px-1.5 cursor-default font-mono"
                                  >
                                    {word}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                  Trigger word — include in your prompt
                                </TooltipContent>
                              </Tooltip>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
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
