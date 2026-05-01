"use client";

import * as React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { type ReviewQueueItem } from "@/components/review-modal";

// ---------------------------------------------------------------------------
// nextNonDecisionedIndex
// ---------------------------------------------------------------------------
// Pure helper. Walks `direction` (+1 next, -1 prev) from `from` looking for the
// closest index whose item id is NOT in the `decisions` map. Returns:
//   - `from + direction` when the decisions map is empty (preserves the
//     existing single-step `j`/`k` behavior on first item, no regression).
//   - the next non-decisioned index in that direction.
//   - `from` UNCHANGED when no non-decisioned candidate exists in that
//     direction (the caller decides what to do — typically: do nothing).
//
// One source of truth for the skip rule shared across the modal's `j`/`k`
// keydown handler and the strip's roving-tabindex arrow keys (US5).
// ---------------------------------------------------------------------------
export function nextNonDecisionedIndex(
  items: ReviewQueueItem[],
  decisions: Map<string, "approved" | "rejected">,
  from: number,
  direction: 1 | -1
): number {
  if (decisions.size === 0) {
    // Fast path / no-regression path: behave exactly like `from + direction`
    // would, clamped to the array bounds.
    const next = from + direction;
    if (next < 0 || next >= items.length) return from;
    return next;
  }
  let cursor = from + direction;
  while (cursor >= 0 && cursor < items.length) {
    const item = items[cursor];
    if (!item) return from;
    if (!decisions.has(item.id)) return cursor;
    cursor += direction;
  }
  // No candidate in this direction. Caller policy: don't move (no wrap).
  return from;
}

// ---------------------------------------------------------------------------
// ReviewFilmstrip
// ---------------------------------------------------------------------------

interface ReviewFilmstripProps {
  items: ReviewQueueItem[];
  activeIndex: number;
  decisions: Map<string, "approved" | "rejected">;
  onActivate: (index: number) => void;
}

export function ReviewFilmstrip({
  items,
  activeIndex,
  decisions,
  onActivate,
}: ReviewFilmstripProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  // Resolve the ScrollArea viewport on mount. Base UI exposes it via
  // [data-slot="scroll-area-viewport"]. Stored in a ref so the auto-scroll
  // effect doesn't have to query on every index change.
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    viewportRef.current = root.querySelector<HTMLDivElement>(
      '[data-slot="scroll-area-viewport"]'
    );
  }, []);

  // T011 + T015 — auto-scroll the active tile to center on activeIndex change.
  // Honors `prefers-reduced-motion: reduce` per US2: smooth when no preference,
  // instant ("auto") when reduce. Effect deps are [activeIndex] only
  // (primitive, per `rerender-dependencies`); the matchMedia read is a
  // per-fire query so the user toggling motion-reduce takes effect on the
  // next nav without a re-mount.
  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const tile = viewport.querySelector<HTMLElement>(
      `[data-slot="filmstrip-tile"][data-index="${activeIndex}"]`
    );
    if (!tile) return;
    const tileCenter = tile.offsetLeft + tile.offsetWidth / 2;
    const target = tileCenter - viewport.clientWidth / 2;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    viewport.scrollTo({
      left: Math.max(0, target),
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, [activeIndex]);

  if (items.length === 0) return null;

  return (
    <div
      ref={rootRef}
      data-slot="review-filmstrip"
      className={cn(
        "relative w-full shrink-0 border-t border-border/60 bg-background/60 backdrop-blur-sm",
        "h-[64px] md:h-[76px]"
      )}
    >
      <ScrollArea className="h-full w-full">
        <div
          className={cn(
            "flex h-full min-w-full items-center gap-2 px-4 py-2",
            // Center the row when the queue is short enough that the rail
            // isn't filled — avoids a forlorn left-aligned cluster. The
            // `min-w-full` on the row + `justify-center` on a flex row that
            // never overflows keeps short queues centered; longer queues
            // scroll naturally because the row's natural width exceeds the
            // viewport.
            "justify-center"
          )}
          style={{ scrollSnapType: "x mandatory" }}
        >
          {items.map((item, i) => {
            const decision = decisions.get(item.id);
            const isActive = i === activeIndex;
            return (
              <FilmstripTile
                key={item.id}
                item={item}
                index={i}
                isActive={isActive}
                decision={decision}
                tabIndex={isActive ? 0 : -1}
                onActivate={onActivate}
              />
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilmstripTile (memoized)
// ---------------------------------------------------------------------------

interface FilmstripTileProps {
  item: ReviewQueueItem;
  index: number;
  isActive: boolean;
  decision: "approved" | "rejected" | undefined;
  tabIndex: 0 | -1;
  onActivate: (index: number) => void;
}

function FilmstripTileImpl({
  item,
  index,
  isActive,
  decision,
  tabIndex,
  onActivate,
}: FilmstripTileProps) {
  // Click is an explicit override — it bypasses the `j`/`k` skip-decisioned
  // rule (per US3 AC #5). Only `j`/`k` and the strip's arrow keys skip; click
  // always lands. See plan.md § "Skip-decisioned navigation".
  const handleClick = () => onActivate(index);

  return (
    <button
      type="button"
      onClick={handleClick}
      tabIndex={tabIndex}
      data-slot="filmstrip-tile"
      data-index={index}
      data-active={isActive ? "true" : undefined}
      data-decision={decision ?? undefined}
      aria-label={`Review item ${index + 1}${
        decision ? ` (${decision})` : ""
      }`}
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "group/filmstrip-tile relative shrink-0 overflow-hidden rounded-md bg-muted",
        "h-[52px] w-[52px] md:h-16 md:w-16",
        "ring-1 ring-foreground/10",
        "transition-[transform,box-shadow,opacity] duration-150 ease-out",
        "hover:ring-primary/40",
        "active:translate-y-px",
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60",
        "motion-reduce:transition-none motion-reduce:active:translate-y-0",
        // Active state — overrides the resting ring.
        isActive && "ring-2 ring-primary",
        // Decisioned state — dim the whole tile so the marker reads.
        decision && "opacity-50"
      )}
      style={{ scrollSnapAlign: "center" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.thumbnailUrl}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
      />

      {/* Decision marker — top-right circle. Matches the modal's emerald/rose
          recipe (review-modal.tsx:7-11, 256-275). */}
      {decision === "approved" && (
        <span
          className="absolute right-1 top-1 inline-flex size-4 items-center justify-center rounded-full bg-background/85 backdrop-blur-sm"
          aria-hidden
        >
          <CheckCircle2 className="size-3 text-emerald-500" />
        </span>
      )}
      {decision === "rejected" && (
        <span
          className="absolute right-1 top-1 inline-flex size-4 items-center justify-center rounded-full bg-background/85 backdrop-blur-sm"
          aria-hidden
        >
          <XCircle className="size-3 text-rose-500" />
        </span>
      )}

      {/* Active-tile notch — primary-colored, centered above the tile. */}
      {isActive && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-2 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-primary"
        />
      )}
    </button>
  );
}

export const FilmstripTile = React.memo(
  FilmstripTileImpl,
  (prev, next) =>
    prev.item.id === next.item.id &&
    prev.isActive === next.isActive &&
    prev.decision === next.decision &&
    prev.tabIndex === next.tabIndex &&
    prev.onActivate === next.onActivate
);

// ---------------------------------------------------------------------------
// FilmstripSkeleton — placeholder used while the strip's lazy-load window is
// out of view. Exported so callers / tests can render a known fallback. Kept
// here so the strip stays self-contained.
// ---------------------------------------------------------------------------

export function FilmstripSkeleton() {
  return (
    <div
      data-slot="review-filmstrip-skeleton"
      className="flex h-[64px] w-full items-center gap-2 border-t border-border/60 bg-background/60 px-4 py-2 backdrop-blur-sm md:h-[76px]"
      aria-busy="true"
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton
          key={i}
          className="size-[52px] shrink-0 rounded-md md:size-16"
        />
      ))}
    </div>
  );
}
