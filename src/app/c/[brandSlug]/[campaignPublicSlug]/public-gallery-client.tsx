"use client";

/**
 * Read-only gallery surface for the public campaign route (T012 + T012a).
 *
 * Hard-coded constraints (FR-006): renders the asset bytes, the file name as
 * alt text, and the creator's display name. NEVER renders prompt, model,
 * provider, parameters, status, cost, fork lineage, tags, reactions, comments,
 * or thread affordances.
 *
 * Empty state (FR-016 / D13): when no approved assets are attached to the
 * campaign yet, render the same shell with a friendly empty state. Do NOT
 * 404 — the URL must be stable while the team is approving content.
 */

import { Download, ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";

interface GalleryAsset {
  id: string;
  url: string;
  fileName: string | null;
  width: number | null;
  height: number | null;
  mediaType: string;
  creatorName: string | null;
}

export interface PublicGalleryClientProps {
  campaign: { name: string };
  brand: { name: string };
  assets: GalleryAsset[];
}

const FALLBACK_CREATOR = "Team member";

export function PublicGalleryClient({
  campaign,
  brand,
  assets,
}: PublicGalleryClientProps) {
  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <Header campaign={campaign} brand={brand} />

      {assets.length === 0 ? (
        <EmptyState />
      ) : (
        <ul
          data-slot="public-gallery-grid"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
        >
          {assets.map((asset) => (
            <li key={asset.id}>
              <AssetTile asset={asset} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Header({
  campaign,
  brand,
}: {
  campaign: { name: string };
  brand: { name: string };
}) {
  return (
    <header className="flex flex-col gap-1.5">
      <p className="text-sm font-medium text-muted-foreground">{brand.name}</p>
      <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
        {campaign.name}
      </h1>
    </header>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-2xl bg-card px-6 py-20 text-center ring-1 ring-foreground/10">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground ring-1 ring-foreground/10">
        <ImageOff className="size-6" strokeWidth={1.5} aria-hidden />
      </div>
      <h2 className="font-heading text-lg font-semibold">No assets yet</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Approved images will appear here once the team publishes them.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssetTile
// ---------------------------------------------------------------------------

function AssetTile({ asset }: { asset: GalleryAsset }) {
  const isVideo = asset.mediaType.startsWith("video");
  const altText = asset.fileName ?? "Asset";
  const creator = asset.creatorName?.trim() ? asset.creatorName : FALLBACK_CREATOR;

  return (
    <figure
      data-slot="public-gallery-tile"
      className={cn(
        "group/tile relative overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/10",
        "transition-shadow hover:ring-primary/30"
      )}
    >
      <div className="relative aspect-square">
        {isVideo ? (
          <video
            src={asset.url}
            controls
            preload="metadata"
            playsInline
            className="h-full w-full object-cover"
            aria-label={altText}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.url}
            alt={altText}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            width={asset.width ?? undefined}
            height={asset.height ?? undefined}
          />
        )}

        {/* Hover overlay: creator name + download. Pointer-events-none on the
            scrim so the underlying media can still be focused / clicked. */}
        <div
          className={cn(
            "pointer-events-none absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-black/75 via-black/10 to-transparent p-3",
            "opacity-0 transition-opacity duration-150",
            "group-hover/tile:opacity-100 group-focus-within/tile:opacity-100"
          )}
        >
          <div className="flex justify-end">
            <DownloadAnchor assetId={asset.id} fileName={asset.fileName} />
          </div>
          <figcaption className="line-clamp-1 text-xs font-medium text-white/95">
            {creator}
          </figcaption>
        </div>
      </div>
    </figure>
  );
}

function DownloadAnchor({
  assetId,
  fileName,
}: {
  assetId: string;
  fileName: string | null;
}) {
  // Same pattern the in-app download UI uses (`<a href>` with `download`),
  // pointing at the proxy route so `Content-Disposition` is honored. The
  // proxy enforces the "approved AND attached to a public campaign" gate
  // for unauthenticated callers (T016 — separate agent).
  const href = `/api/assets/${assetId}/download?variant=webp`;
  const label = fileName ? `Download ${fileName}` : "Download asset";

  return (
    <a
      href={href}
      download
      rel="noopener"
      aria-label={label}
      className={cn(
        "pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-lg bg-background/80 text-foreground backdrop-blur-sm",
        "ring-1 ring-foreground/10 transition-colors",
        "hover:bg-background hover:ring-primary/40",
        "active:translate-y-px",
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
      )}
    >
      <Download className="size-4" aria-hidden />
    </a>
  );
}
