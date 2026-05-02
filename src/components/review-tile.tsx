"use client";

import { useState } from "react";
import { ImageOff, Megaphone, TriangleAlert, Video } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type ReviewQueueItem } from "@/components/review-modal";

// Re-export so callers can import the tile + the type from one module.
export type { ReviewQueueItem };

interface ReviewTileProps {
  item: ReviewQueueItem;
  index: number;
  onActivate: (index: number) => void;
}

export function ReviewTile({ item, index, onActivate }: ReviewTileProps) {
  const authorLabel =
    item.author.name?.trim() ||
    item.author.email?.split("@")[0] ||
    "Unknown member";
  const [imgFailed, setImgFailed] = useState(false);
  const initials = (() => {
    const parts = authorLabel.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  })();

  return (
    <button
      type="button"
      onClick={() => onActivate(index)}
      data-slot="review-tile"
      data-index={index}
      aria-label={`Open review item ${index + 1}`}
      className={cn(
        "group/tile relative cursor-pointer overflow-hidden rounded-xl bg-muted text-left",
        "ring-1 ring-foreground/10",
        "transition-[transform,box-shadow] duration-150 ease-out",
        "hover:-translate-y-0.5 hover:shadow-lg hover:ring-primary/40",
        "active:translate-y-px",
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        "motion-reduce:active:translate-y-0"
      )}
    >
      <div className="relative aspect-square">
        {imgFailed ? (
          <div className="flex h-full w-full items-center justify-center">
            <ImageOff className="size-8 text-muted-foreground/40" aria-hidden />
          </div>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={item.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
          />
        )}

        {/* Top-left: media-type indicator (image is implicit, video gets a chip) */}
        <div className="absolute left-2 top-2 flex flex-wrap items-center gap-1">
          {item.mediaType === "video" && (
            <Badge
              variant="secondary"
              className="gap-1 bg-background/85 text-foreground ring-1 ring-foreground/15 backdrop-blur-sm"
            >
              <Video className="size-3" aria-hidden />
              Video
            </Badge>
          )}
          {item.campaigns.length > 0 ? (
            <span
              className="inline-flex h-5 max-w-[140px] items-center gap-1 rounded-md bg-primary/15 px-1.5 text-[10px] font-medium text-primary ring-1 ring-primary/25 backdrop-blur-sm"
              title={item.campaigns.map((c) => c.name).join(", ")}
            >
              <Megaphone className="size-2.5 shrink-0" aria-hidden />
              <span className="truncate">
                {item.campaigns.length === 1
                  ? item.campaigns[0].name
                  : `${item.campaigns.length} campaigns`}
              </span>
            </span>
          ) : (
            <span
              className="inline-flex h-5 items-center gap-1 rounded-md bg-background/70 px-1.5 text-[10px] font-medium text-muted-foreground ring-1 ring-foreground/15 backdrop-blur-sm"
              aria-label="No campaign"
            >
              <Megaphone className="size-2.5 opacity-60" aria-hidden />
              <span aria-hidden>—</span>
            </span>
          )}
        </div>

        {/* Top-right: brand-kit-overridden warning marker (icon-only to avoid colliding
            with the Video badge at small breakpoints). Full text moves into the
            prompt overlay below so triagers still see it on hover/focus. */}
        {item.brandKitOverridden && (
          <span
            role="img"
            aria-label="Brand kit overridden"
            className="absolute right-2 top-2 inline-flex items-center justify-center rounded border border-amber-500/40 bg-amber-500/10 p-1 text-amber-700 backdrop-blur-sm dark:text-amber-300"
          >
            <TriangleAlert className="size-3" aria-hidden />
          </span>
        )}

        {/* Bottom-right: author avatar (matches CreatorAvatar pattern in library-client) */}
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className="absolute bottom-2 right-2 inline-flex rounded-full ring-2 ring-background/80"
                aria-label={`${authorLabel} submitted this asset`}
              >
                <Avatar size="sm" className="size-6">
                  {item.author.image ? (
                    <AvatarImage src={item.author.image} alt="" />
                  ) : null}
                  <AvatarFallback className="text-[10px]">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </span>
            }
          />
          <TooltipContent>{authorLabel} submitted this asset</TooltipContent>
        </Tooltip>

        {/* Prompt overlay — visible on hover/focus */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/75 via-black/20 to-transparent p-3 opacity-0 transition-opacity duration-150 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100">
          {item.brandKitOverridden && (
            <p className="text-[10px] font-medium text-amber-300/95">
              Brand kit overridden
            </p>
          )}
          <p className="line-clamp-1 text-xs font-medium text-white/95">
            {item.prompt}
          </p>
          <p className="mt-0.5 text-[10px] text-white/70">{authorLabel}</p>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Skeleton — 12 placeholder tiles in the same grid layout as ReviewGallery.
// Co-located here so the gallery can import a single module.
// ---------------------------------------------------------------------------

export function ReviewGallerySkeleton() {
  return (
    <div
      data-slot="review-gallery-skeleton"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
      aria-busy="true"
      aria-label="Loading review queue"
    >
      {Array.from({ length: 12 }).map((_, i) => (
        <Skeleton
          key={i}
          className="aspect-square w-full rounded-xl ring-1 ring-foreground/10"
        />
      ))}
    </div>
  );
}
