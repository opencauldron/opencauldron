import { Skeleton } from "@/components/ui/skeleton";

interface ActivitySkeletonProps {
  /** How many rows to render. Default 6 — roughly one screen on a laptop. */
  count?: number;
  /** Match the equivalent `<ActivityRow variant>` so the skeleton → real-row
   *  transition doesn't snap. Compact drops the thumbnail Skeleton, swaps
   *  the avatar to size-7, and tightens vertical padding. */
  variant?: "default" | "compact";
}

/**
 * Loading skeleton — wraps `Skeleton` from the shared UI lib (per design
 * rules, no custom shimmer). Mirrors the row layout closely so the
 * transition from skeleton → real rows doesn't reflow.
 */
export function ActivitySkeleton({
  count = 6,
  variant = "default",
}: ActivitySkeletonProps) {
  const compact = variant === "compact";
  const rowClasses = compact
    ? "flex items-start gap-3 px-4 py-2"
    : "flex items-start gap-3 px-4 py-3";
  const avatarSize = compact ? "size-7" : "size-8";
  return (
    <div
      role="status"
      aria-label="Loading activity"
      className="divide-y divide-border/60"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={rowClasses}>
          <Skeleton className={`${avatarSize} shrink-0 rounded-full`} />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-3/4 rounded" />
            <Skeleton className="h-3 w-1/2 rounded" />
          </div>
          {compact ? null : (
            <Skeleton className="size-10 shrink-0 rounded-lg" />
          )}
          <Skeleton className="mt-1 h-2.5 w-8 shrink-0 rounded" />
        </div>
      ))}
      <span className="sr-only">Loading activity feed</span>
    </div>
  );
}
