"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/avatar";
import { Search, FlaskConical, Loader2 } from "lucide-react";
import type { PublicBrew } from "@/types";

interface ModelOption {
  value: string;
  label: string;
}

const SORT_OPTIONS = [
  { value: "recent", label: "Recent" },
  { value: "popular", label: "Most Used" },
];

const PAGE_SIZE = 12;

export function ExploreClient() {
  const router = useRouter();
  const [brews, setBrews] = useState<PublicBrew[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [model, setModel] = useState("");
  const [creator, setCreator] = useState("");
  const [sort, setSort] = useState("recent");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [creators, setCreators] = useState<{ value: string; label: string }[]>([]);

  const sentinelRef = useRef<HTMLDivElement>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch available image models for filter
  useEffect(() => {
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { models: Array<{ id: string; name: string; mediaType: string }> }) => {
        const imageModels = data.models
          .filter((m) => m.mediaType === "image")
          .map((m) => ({ value: m.id, label: m.name }));
        setModels([{ value: "", label: "All Models" }, ...imageModels]);
      })
      .catch(() => {});
  }, []);

  // Fetch brews
  const fetchBrews = useCallback(
    async (newOffset: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setIsLoading(true);

      try {
        const params = new URLSearchParams();
        params.set("offset", String(newOffset));
        params.set("limit", String(PAGE_SIZE));
        if (debouncedSearch) params.set("search", debouncedSearch);
        if (model) params.set("model", model);
        if (creator) params.set("author", creator);
        params.set("sort", sort);

        const res = await fetch(`/api/brews/explore?${params}`);
        if (!res.ok) throw new Error();

        const data = (await res.json()) as { brews: PublicBrew[]; hasMore: boolean };

        if (append) {
          setBrews((prev) => [...prev, ...data.brews]);
        } else {
          setBrews(data.brews);
        }

        // Build creator list from all seen brews
        setCreators((prev) => {
          const map = new Map(prev.map((c) => [c.value, c.label]));
          for (const b of data.brews) {
            if (b.userId && b.authorName && !map.has(b.userId)) {
              map.set(b.userId, b.authorName);
            }
          }
          return Array.from(map, ([value, label]) => ({ value, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
        });
        setHasMore(data.hasMore);
        setOffset(newOffset + data.brews.length);
      } catch {
        // silent fail for explore
      } finally {
        setIsLoading(false);
        setLoadingMore(false);
      }
    },
    [debouncedSearch, model, creator, sort]
  );

  // Reset and fetch when filters change
  useEffect(() => {
    setOffset(0);
    fetchBrews(0, false);
  }, [fetchBrews]);

  // Infinite scroll observer
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !isLoading) {
          fetchBrews(offset, true);
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, isLoading, offset, fetchBrews]);

  const initials = (name: string | null) =>
    name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase() ?? "?";

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search brews..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="w-44">
          <Select value={model} onValueChange={(v) => setModel(v ?? "")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All Models" />
            </SelectTrigger>
            <SelectContent>
              {models.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-44">
          <Select value={creator} onValueChange={(v) => setCreator(v ?? "")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All Creators" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Creators</SelectItem>
              {creators.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-36">
          <Select value={sort} onValueChange={(v) => setSort(v ?? "recent")}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-3 rounded-xl border border-border/40 p-4">
              <Skeleton className="h-32 rounded-lg" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : brews.length === 0 ? (
        /* Empty state */
        <div className="text-center py-20 space-y-3">
          <FlaskConical className="h-10 w-10 mx-auto text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No public brews yet</p>
          <p className="text-xs text-muted-foreground/60">
            Be the first to publish a brew and share it with the community.
          </p>
        </div>
      ) : (
        /* Grid */
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {brews.map((brew) => (
              <div
                key={brew.id}
                className="group relative rounded-xl border border-border/40 bg-card overflow-hidden transition-all duration-200 hover:border-border hover:shadow-md cursor-pointer"
                onClick={() => router.push(`/brew/${brew.slug}`)}
              >
                {/* Preview */}
                <div className="aspect-video bg-muted/20 overflow-hidden">
                  {brew.previewUrl ? (
                    <img
                      src={brew.previewUrl}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center">
                      <FlaskConical className="h-8 w-8 text-muted-foreground/15" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-3.5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-medium leading-tight line-clamp-1">
                      {brew.name}
                    </h3>
                    <Badge variant="outline" className="text-[9px] shrink-0">
                      {brew.model}
                    </Badge>
                  </div>

                  {brew.description ? (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {brew.description}
                    </p>
                  ) : null}

                  {/* Author + meta */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-1.5">
                      <Avatar className="h-5 w-5">
                        {brew.authorImage ? (
                          <AvatarImage src={brew.authorImage} alt={brew.authorName ?? ""} />
                        ) : null}
                        <AvatarFallback className="text-[8px]">
                          {initials(brew.authorName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-[11px] text-muted-foreground">
                        {brew.authorName ?? "Unknown"}
                      </span>
                    </div>
                    {brew.usageCount > 0 ? (
                      <Badge variant="outline" className="text-[9px] font-normal">
                        Used {brew.usageCount}x
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="flex justify-center py-4">
            {loadingMore ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
