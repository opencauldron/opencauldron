"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Hash,
  ImagePlus,
  Loader2,
  SearchX,
  Sparkles,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { LibraryDetailPanel, type LibraryBrand } from "./detail-panel";
import {
  FilterBar,
  BrandFacet,
  CampaignFacet,
  TagFacet,
  SourceFacet,
  StatusFacet,
  type BrandOption,
  type CampaignOption,
  type TagOption,
} from "./filter-bar";
import { SearchInput } from "./search-input";
import {
  serializeLibraryQuery,
  useLibraryQuery,
  parseLibraryQuery,
  LibraryQueryProvider,
} from "./use-library-query";

// ---------------------------------------------------------------------------
// Types — exported so page.tsx can produce the initial payload server-side.
// ---------------------------------------------------------------------------

export type AssetSource = "uploaded" | "generated" | "imported";

export interface LibraryAsset {
  id: string;
  userId: string;
  brandId: string | null;
  source: AssetSource;
  mediaType: "image" | "video";
  url: string;
  thumbnailUrl: string;
  fileName: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  usageCount: number;
  embeddedAt: string | null;
  createdAt: string;
  tags: string[];
  campaigns: string[];
}

interface LibraryClientProps {
  initialItems: LibraryAsset[];
  initialNextCursor: string | null;
  initialTotal: number;
  initialBrands: LibraryBrand[];
  facetBrands: BrandOption[];
  facetCampaigns: CampaignOption[];
  facetTags: TagOption[];
  hasMixedStatuses: boolean;
}

// ---------------------------------------------------------------------------
// Outer container — owns the LibraryQueryProvider so every facet shares the
// same URL-synced state. The inner <LibraryGridContainer> reads the query
// and triggers fetches.
// ---------------------------------------------------------------------------

export function LibraryClient(props: LibraryClientProps) {
  return (
    <LibraryQueryProvider>
      <LibraryToolbar {...props} />
      <LibraryGridContainer {...props} />
    </LibraryQueryProvider>
  );
}

// ---------------------------------------------------------------------------
// Toolbar — sticky FilterBar above the grid.
// ---------------------------------------------------------------------------

function LibraryToolbar({
  facetBrands,
  facetCampaigns,
  facetTags,
  hasMixedStatuses,
}: LibraryClientProps) {
  return (
    <FilterBar>
      <div className="flex items-center gap-2">
        <FilterBar.Search>
          <SearchInput>
            <SearchInput.Field />
            <SearchInput.ModeToggle />
          </SearchInput>
        </FilterBar.Search>
        <FilterBar.Facets>
          <BrandFacet brands={facetBrands} />
          <CampaignFacet campaigns={facetCampaigns} />
          <TagFacet tags={facetTags} />
          <FilterBar.More>
            <SourceFacet />
            <StatusFacet visible={hasMixedStatuses} />
          </FilterBar.More>
        </FilterBar.Facets>
        <FilterBar.MobileSheet
          brands={facetBrands}
          campaigns={facetCampaigns}
          tags={facetTags}
          hasMixedStatuses={hasMixedStatuses}
        />
      </div>
      <FilterBar.Summary
        brands={facetBrands}
        campaigns={facetCampaigns}
        tags={facetTags}
      />
    </FilterBar>
  );
}

// ---------------------------------------------------------------------------
// Grid container — owns the items state, fetches on URL change, hosts the
// detail panel. Initial paint is server-rendered (no filters, page 1) so
// TTFB stays tight. Once the URL has filters or search, we re-fetch.
// ---------------------------------------------------------------------------

function LibraryGridContainer({
  initialItems,
  initialNextCursor,
  initialTotal,
  initialBrands,
}: LibraryClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setResultsCount, isPending, query, activeCount, clearAll } =
    useLibraryQuery();

  const [items, setItems] = useState<LibraryAsset[]>(initialItems);
  const [nextCursor, setNextCursor] = useState<string | null>(
    initialNextCursor
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [brands, setBrands] = useState<LibraryBrand[]>(initialBrands);

  // Seed the first count immediately so the summary line doesn't flicker on
  // the initial render with filters that match the server-hydrated set.
  useEffect(() => {
    setResultsCount(initialTotal);
    // Intentionally only on mount — subsequent updates come from fetch
    // responses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Tracks the cursor of an in-flight request. Synchronous (a ref, not state)
  // so two observer callbacks firing back-to-back can't both fetch the same
  // page and produce duplicate React keys.
  const inFlightCursorRef = useRef<string | null>(null);
  const lastQueryStringRef = useRef<string>(searchParams.toString());

  // Whenever the URL filter state changes, refetch page 1 with those filters.
  useEffect(() => {
    const next = searchParams.toString();
    if (next === lastQueryStringRef.current) return;
    lastQueryStringRef.current = next;

    let cancelled = false;
    setLoadingPage(true);

    const sp = serializeLibraryQuery(parseLibraryQuery(searchParams));
    sp.set("limit", "50");

    fetch(`/api/library?${sp.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return (await res.json()) as {
          items: LibraryAsset[];
          nextCursor: string | null;
          total: number;
        };
      })
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setNextCursor(data.nextCursor);
        setResultsCount(data.total);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error("Couldn't apply filters. Try again.");
      })
      .finally(() => {
        if (!cancelled) setLoadingPage(false);
      });

    return () => {
      cancelled = true;
    };
  }, [searchParams, setResultsCount]);

  const loadMore = useCallback(
    async (cursor: string) => {
      if (inFlightCursorRef.current === cursor) return;
      inFlightCursorRef.current = cursor;
      setLoadingMore(true);
      try {
        const sp = serializeLibraryQuery(parseLibraryQuery(searchParams));
        sp.set("limit", "30");
        sp.set("cursor", cursor);
        const res = await fetch(`/api/library?${sp.toString()}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as {
          items: LibraryAsset[];
          nextCursor: string | null;
          total: number;
        };
        setItems((prev) => {
          const seen = new Set(prev.map((it) => it.id));
          const fresh = data.items.filter((it) => !seen.has(it.id));
          return fresh.length === data.items.length
            ? [...prev, ...data.items]
            : [...prev, ...fresh];
        });
        setNextCursor(data.nextCursor);
        setResultsCount(data.total);
      } catch {
        toast.error("Couldn't load more assets. Try again.");
      } finally {
        inFlightCursorRef.current = null;
        setLoadingMore(false);
      }
    },
    [searchParams, setResultsCount]
  );

  // Cursor-driven infinite scroll. Disabled while a full-page filter fetch
  // is in flight so we don't double-spinner.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (!nextCursor) return;
    if (loadingPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && nextCursor && !loadingMore) {
          loadMore(nextCursor);
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextCursor, loadingMore, loadingPage, loadMore]);

  const refreshBrands = useCallback(async () => {
    try {
      const res = await fetch("/api/brands");
      if (!res.ok) return;
      const rows = (await res.json()) as Array<{
        id: string;
        name: string;
        color: string;
        isPersonal: boolean;
      }>;
      setBrands((prev) => {
        const byId = new Map(prev.map((b) => [b.id, b]));
        return rows.map((r) => ({
          id: r.id,
          name: r.name,
          color: r.color,
          isPersonal: r.isPersonal,
          anchorAssetIds: byId.get(r.id)?.anchorAssetIds ?? [],
        }));
      });
    } catch {
      /* non-fatal */
    }
  }, []);

  const handleAssetUpdate = useCallback((next: LibraryAsset) => {
    setItems((prev) => prev.map((it) => (it.id === next.id ? next : it)));
  }, []);

  const handleAssetDelete = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setSelectedId((curr) => (curr === id ? null : curr));
  }, []);

  const handleBrandPinChange = useCallback(
    (brandId: string, assetId: string, pinned: boolean) => {
      setBrands((prev) =>
        prev.map((b) => {
          if (b.id !== brandId) return b;
          const set = new Set(b.anchorAssetIds);
          if (pinned) set.add(assetId);
          else set.delete(assetId);
          return { ...b, anchorAssetIds: Array.from(set) };
        })
      );
      refreshBrands();
    },
    [refreshBrands]
  );

  const selected = selectedId
    ? items.find((it) => it.id === selectedId) ?? null
    : null;

  // Empty states differ based on whether filters are active.
  const isEmpty = items.length === 0 && !loadingPage;
  const filteredEmpty = isEmpty && activeCount > 0;
  const blankEmpty = isEmpty && activeCount === 0;

  // Suppress mismatch suspicion: `useRouter` is used only for the empty-state
  // CTAs; not needed in the main render path.
  void router;

  return (
    <div className="space-y-4 pt-2">
      <div
        // Subtle dim while a transition or filter fetch is pending — keeps
        // the user oriented without ripping the grid out from under them.
        className={cn(
          "transition-opacity duration-150",
          (isPending || loadingPage) && items.length > 0 && "opacity-60"
        )}
        aria-busy={isPending || loadingPage || undefined}
      >
        {blankEmpty && <LibraryBlankEmptyState />}
        {filteredEmpty && (
          <LibraryFilteredEmpty
            query={query}
            onClearAll={clearAll}
          />
        )}
        {!isEmpty && <LibraryGrid items={items} onSelect={setSelectedId} />}

        {/* Sentinel + spinner. Sentinel is always rendered when more pages exist
            so the observer keeps a target after each successful page. */}
        {nextCursor && !loadingPage && (
          <div ref={sentinelRef} className="h-4" aria-hidden />
        )}
        {loadingMore && (
          <div
            role="status"
            aria-label="Loading more assets"
            className="flex justify-center py-6"
          >
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      <LibraryDetailPanel
        asset={selected}
        brands={brands}
        onClose={() => setSelectedId(null)}
        onAssetUpdate={handleAssetUpdate}
        onAssetDelete={handleAssetDelete}
        onBrandPinChange={handleBrandPinChange}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

function LibraryGrid({
  items,
  onSelect,
}: {
  items: LibraryAsset[];
  onSelect: (id: string) => void;
}) {
  return (
    <div
      data-slot="library-grid"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
    >
      {items.map((item) => (
        <LibraryCard
          key={item.id}
          asset={item}
          onClick={() => onSelect(item.id)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card — square thumbnail, source badge, hover overlay with metadata.
// ---------------------------------------------------------------------------

function LibraryCard({
  asset,
  onClick,
}: {
  asset: LibraryAsset;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-slot="library-card"
      className={cn(
        "group/card relative overflow-hidden rounded-xl bg-muted text-left",
        "ring-1 ring-foreground/10",
        "hover:-translate-y-0.5 hover:shadow-lg hover:ring-primary/40",
        "active:translate-y-px",
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
      )}
      aria-label={asset.fileName ?? `Asset ${asset.id.slice(0, 8)}`}
    >
      <div className="relative aspect-square">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.thumbnailUrl}
          alt={asset.fileName ?? "Library asset"}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />

        <div className="absolute left-2 top-2">
          <SourceBadge source={asset.source} />
        </div>

        {asset.usageCount > 0 && (
          <div className="absolute right-2 top-2 inline-flex items-center gap-0.5 rounded-md bg-background/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-foreground backdrop-blur-sm">
            <Hash className="size-2.5" aria-hidden />
            {asset.usageCount}
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/75 via-black/20 to-transparent p-3 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100 group-focus-visible/card:opacity-100">
          {asset.fileName && (
            <p className="line-clamp-1 text-xs font-medium text-white/95">
              {asset.fileName}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {asset.width && asset.height && (
              <span className="rounded-sm bg-white/20 px-1.5 py-0.5 text-[10px] font-medium text-white/95 backdrop-blur-sm">
                {asset.width}×{asset.height}
              </span>
            )}
            {asset.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="rounded-sm bg-white/20 px-1.5 py-0.5 text-[10px] font-medium text-white/95 backdrop-blur-sm"
              >
                {tag}
              </span>
            ))}
            {asset.tags.length > 2 && (
              <span className="rounded-sm bg-white/20 px-1.5 py-0.5 text-[10px] font-medium text-white/95 backdrop-blur-sm">
                +{asset.tags.length - 2}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Source badge — three explicit variants so we don't pile booleans on Badge.
// ---------------------------------------------------------------------------

function SourceBadge({ source }: { source: AssetSource }) {
  const label =
    source === "uploaded"
      ? "Upload"
      : source === "generated"
      ? "Generated"
      : "Imported";

  const variantClass =
    source === "generated"
      ? "bg-primary/15 text-primary ring-primary/25"
      : source === "uploaded"
      ? "bg-background/85 text-foreground ring-foreground/15"
      : "bg-accent text-accent-foreground ring-foreground/15";

  return (
    <span
      data-slot="source-badge"
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium ring-1 backdrop-blur-sm",
        variantClass
      )}
    >
      {source === "generated" ? (
        <Sparkles className="size-2.5" aria-hidden />
      ) : null}
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Empty states — two distinct shapes per the design brief.
//   1. Blank library (no items, no filters) — encourage upload/generate.
//   2. Filtered empty (filters active, zero matches) — explain + offer clear.
// ---------------------------------------------------------------------------

function LibraryBlankEmptyState() {
  const router = useRouter();
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center rounded-2xl bg-card px-6 py-20 text-center ring-1 ring-foreground/10"
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <ImagePlus className="size-7" strokeWidth={1.5} aria-hidden />
      </div>
      <h3 className="font-heading text-lg font-semibold">
        Nothing in your library yet
      </h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Upload an image or generate something — every asset you create lands
        here, ready to tag, pin, and reuse.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => router.push("/generate")}>
          <Wand2 aria-hidden />
          Generate something
        </Button>
        <Button
          variant="outline"
          onClick={() => router.push("/generate?focus=imageInput")}
        >
          <ImagePlus aria-hidden />
          Upload a reference
        </Button>
      </div>
    </div>
  );
}

function LibraryFilteredEmpty({
  onClearAll,
}: {
  query: ReturnType<typeof useLibraryQuery>["query"];
  onClearAll: () => void;
}) {
  // TODO(library-dam Phase 5): when the API returns `dropFilterCounts`, render
  // a "Drop X (+N results)" CTA next to "Clear all filters" for the most-
  // restrictive facet.
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center rounded-2xl bg-card px-6 py-16 text-center ring-1 ring-foreground/10"
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/40 text-muted-foreground">
        <SearchX className="size-7" strokeWidth={1.5} aria-hidden />
      </div>
      <h3 className="font-heading text-lg font-semibold">
        No matches for these filters.
      </h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Try removing the brand or broadening tags.
      </p>
      <div className="mt-5">
        <Button variant="outline" onClick={onClearAll}>
          Clear all filters
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton (kept for the dynamic import / CSR fallback the picker may
// eventually wire up).
// ---------------------------------------------------------------------------

export function LibrarySkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: 12 }).map((_, i) => (
        <Skeleton key={i} className="aspect-square rounded-xl" />
      ))}
    </div>
  );
}
