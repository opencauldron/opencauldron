"use client";

import { memo, useEffect, useState } from "react";
import { Lock, Sparkles, Upload, Wand2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// `asset_ref` attachment renderer (T047).
//
// Renders as a tactile card: thumbnail (left) + filename + source badge
// (right). Click → opens that asset's detail panel via the existing URL
// contract (`?asset=<id>`). Stays in the same tab so the user doesn't lose
// thread context (the panel is a Sheet inside `/library`).
//
// Defense-in-depth (FR-005 / spec line 52): on mount we fetch
// `/api/threads/asset-ref/<assetId>` to verify the viewer can access the
// referenced asset. 200 → render the card with hydrated thumbnail; 403/404
// → render the "Restricted asset" placeholder. The fetch is keyed by the
// assetId so re-mounts (live SSE updates of the message) don't refetch
// unnecessarily.
//
// We keep the card visually consistent with the asset cards in the library
// list — square thumbnail, source-badge tint, gentle hover lift. The picker
// dialog reuses the same primitive.
// ---------------------------------------------------------------------------

export interface AssetRefAttachmentProps {
  assetId: string;
  /** Optional fallback name from the message (server may have stamped it). */
  fallbackDisplayName?: string | null;
}

interface ResolvedAsset {
  id: string;
  url: string;
  thumbnailUrl: string;
  fileName: string | null;
  width: number | null;
  height: number | null;
  source: "uploaded" | "generated" | "imported";
  mediaType: "image" | "video";
  mimeType: string | null;
}

type State =
  | { status: "loading" }
  | { status: "ready"; asset: ResolvedAsset }
  | { status: "restricted" };

function AssetRefAttachmentImpl({
  assetId,
  fallbackDisplayName,
}: AssetRefAttachmentProps) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // setState happens inside the async closure to satisfy
      // `react-hooks/set-state-in-effect`. The visible flash from any pre-
      // loading render is acceptable — the skeleton renders identically.
      setState({ status: "loading" });
      try {
        const res = await fetch(`/api/threads/asset-ref/${assetId}`, {
          // The thumbnail urls are signed for 1h; cache aggressively at the
          // browser layer to avoid re-resolving on every panel re-render.
          cache: "force-cache",
        });
        if (cancelled) return;
        if (res.status === 403 || res.status === 404) {
          setState({ status: "restricted" });
          return;
        }
        if (!res.ok) {
          // Treat 5xx as restricted-equivalent — we don't want to leak a
          // server hiccup as a misleading card. The user can refresh.
          setState({ status: "restricted" });
          return;
        }
        const json = (await res.json()) as { asset: ResolvedAsset };
        if (cancelled) return;
        setState({ status: "ready", asset: json.asset });
      } catch {
        if (!cancelled) setState({ status: "restricted" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  if (state.status === "loading") {
    return <AssetRefSkeleton />;
  }

  if (state.status === "restricted") {
    return <RestrictedPlaceholder fileName={fallbackDisplayName ?? null} />;
  }

  const asset = state.asset;
  const displayName = asset.fileName ?? fallbackDisplayName ?? "Library asset";

  return (
    <a
      data-slot="asset-ref-attachment"
      href={`/library?asset=${asset.id}`}
      className={cn(
        "mt-1.5 inline-flex max-w-full items-center gap-2.5 rounded-lg bg-card p-1.5",
        "text-left ring-1 ring-foreground/10 transition-all",
        "hover:bg-accent hover:ring-foreground/15",
        "active:translate-y-px"
      )}
      aria-label={`Open library asset ${displayName}`}
    >
      <div className="size-12 shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-foreground/5">
        {asset.mediaType === "video" ? (
          <video
            src={asset.url}
            muted
            playsInline
            preload="metadata"
            className="size-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.thumbnailUrl}
            alt={displayName}
            className="size-full object-cover"
            loading="lazy"
            decoding="async"
          />
        )}
      </div>
      <div className="min-w-0 flex-1 pr-1">
        <div className="truncate text-sm font-medium text-foreground">
          {displayName}
        </div>
        <SourceBadge source={asset.source} mediaType={asset.mediaType} />
      </div>
    </a>
  );
}

export const AssetRefAttachment = memo(AssetRefAttachmentImpl);

// ---------------------------------------------------------------------------
// Sub-pieces
// ---------------------------------------------------------------------------

function SourceBadge({
  source,
  mediaType,
}: {
  source: ResolvedAsset["source"];
  mediaType: ResolvedAsset["mediaType"];
}) {
  const sourceLabel =
    source === "generated"
      ? "Generated"
      : source === "uploaded"
        ? "Uploaded"
        : "Imported";
  const Icon =
    source === "generated"
      ? Wand2
      : source === "imported"
        ? Sparkles
        : Upload;
  return (
    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
      <Icon className="size-3" aria-hidden />
      <span>{sourceLabel}</span>
      <span aria-hidden>·</span>
      <span>{mediaType === "video" ? "Video" : "Image"}</span>
    </div>
  );
}

function AssetRefSkeleton() {
  return (
    <div
      aria-hidden
      className="mt-1.5 inline-flex max-w-full items-center gap-2.5 rounded-lg bg-card p-1.5 ring-1 ring-foreground/10"
    >
      <Skeleton className="size-12 rounded-md" />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-2.5 w-20" />
      </div>
    </div>
  );
}

function RestrictedPlaceholder({ fileName }: { fileName: string | null }) {
  return (
    <div
      data-slot="asset-ref-restricted"
      className={cn(
        "mt-1.5 inline-flex max-w-full items-center gap-2.5 rounded-lg bg-muted/50 p-1.5",
        "text-muted-foreground ring-1 ring-foreground/5"
      )}
      aria-label="This asset isn't available in your workspace"
    >
      <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted ring-1 ring-foreground/5">
        <Lock className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 pr-1">
        <div className="truncate text-sm font-medium">Restricted asset</div>
        <div className="text-[10px] uppercase tracking-wide">
          {fileName ? "Outside this workspace" : "Not available"}
        </div>
      </div>
    </div>
  );
}
