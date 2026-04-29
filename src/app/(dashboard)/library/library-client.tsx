"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Hash, ImagePlus, Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { LibraryDetailPanel, type LibraryBrand } from "./detail-panel";

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
  initialBrands: LibraryBrand[];
}

// ---------------------------------------------------------------------------
// Container — owns cursor state, fetches more pages, hosts the detail panel.
// Composition: <LibraryClient> renders <LibraryGrid> + <LibraryDetailPanel>.
// No boolean-prop sprawl: the panel's open state is derived from selection.
// ---------------------------------------------------------------------------

export function LibraryClient({
  initialItems,
  initialNextCursor,
  initialBrands,
}: LibraryClientProps) {
  const [items, setItems] = useState<LibraryAsset[]>(initialItems);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [brands, setBrands] = useState<LibraryBrand[]>(initialBrands);

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(
    async (cursor: string) => {
      setLoadingMore(true);
      try {
        const params = new URLSearchParams({ limit: "30", cursor });
        const res = await fetch(`/api/library?${params.toString()}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as {
          items: LibraryAsset[];
          nextCursor: string | null;
        };
        setItems((prev) => [...prev, ...data.items]);
        setNextCursor(data.nextCursor);
      } catch {
        toast.error("Couldn't load more assets. Try again.");
      } finally {
        setLoadingMore(false);
      }
    },
    []
  );

  // Cursor-driven infinite scroll. IntersectionObserver beats a scroll-listener
  // here — no rAF throttling needed, observer fires once per intersection.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (!nextCursor) return;

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
  }, [nextCursor, loadingMore, loadMore]);

  // Keep `brands` fresh after a pin toggle — anchor lists live on brand rows.
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
      // Keep our anchor map authoritative — brands API doesn't include
      // anchorAssetIds on the list endpoint. We patch them in via a per-brand
      // GET on first need, but for the toggle UI the previous list + the
      // panel's local update is enough to stay in sync.
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

  const handleAssetUpdate = useCallback(
    (next: LibraryAsset) => {
      setItems((prev) => prev.map((it) => (it.id === next.id ? next : it)));
    },
    []
  );

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
      // Best-effort refresh in the background so we pick up server-side
      // anchor-list invariants (e.g. dedupe, max-16 enforcement).
      refreshBrands();
    },
    [refreshBrands]
  );

  const selected = selectedId
    ? items.find((it) => it.id === selectedId) ?? null
    : null;

  if (items.length === 0) {
    return <LibraryEmptyState />;
  }

  return (
    <>
      <LibraryGrid items={items} onSelect={setSelectedId} />

      {/* Sentinel + spinner. Sentinel is always rendered when more pages exist
          so the observer keeps a target after each successful page. */}
      {nextCursor && <div ref={sentinelRef} className="h-4" aria-hidden />}
      {loadingMore && (
        <div
          role="status"
          aria-label="Loading more assets"
          className="flex justify-center py-6"
        >
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      <LibraryDetailPanel
        asset={selected}
        brands={brands}
        onClose={() => setSelectedId(null)}
        onAssetUpdate={handleAssetUpdate}
        onAssetDelete={handleAssetDelete}
        onBrandPinChange={handleBrandPinChange}
      />
    </>
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
// Mirrors references-client's visual treatment but adds a source badge and
// wires through tags. Plain <img> matches the rest of the codebase (signed
// R2 URLs aren't on the next.config remotePatterns allow-list).
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

        {/* Source badge — top-left so it doesn't fight the usage count. */}
        <div className="absolute left-2 top-2">
          <SourceBadge source={asset.source} />
        </div>

        {/* Usage count — only when > 0; tabular-nums so the box doesn't jump. */}
        {asset.usageCount > 0 && (
          <div className="absolute right-2 top-2 inline-flex items-center gap-0.5 rounded-md bg-background/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-foreground backdrop-blur-sm">
            <Hash className="size-2.5" aria-hidden />
            {asset.usageCount}
          </div>
        )}

        {/* Hover overlay — fades in metadata + dimensions chip. */}
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
// Tinted, not filled — matches the destructive-style convention.
// ---------------------------------------------------------------------------

function SourceBadge({ source }: { source: AssetSource }) {
  const label =
    source === "uploaded"
      ? "Upload"
      : source === "generated"
      ? "Generated"
      : "Imported";

  // Each source gets a single token-based tint. We avoid raw color literals;
  // primary covers generated (the magical path), muted covers uploads,
  // accent covers imports — all already first-class semantic tokens.
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
// Empty state — short, encouraging, action-oriented per the voice guide.
// ---------------------------------------------------------------------------

function LibraryEmptyState() {
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
          onClick={() =>
            router.push("/generate?focus=imageInput")
          }
        >
          <ImagePlus aria-hidden />
          Upload a reference
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton (unused on first paint — page.tsx ships data — kept for the
// dynamic import / CSR fallback the picker may eventually wire up.)
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
