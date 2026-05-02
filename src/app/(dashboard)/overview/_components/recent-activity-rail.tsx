import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ActivitySkeleton } from "@/app/(dashboard)/activity/_components/activity-skeleton";
import { getAssetUrl } from "@/lib/storage";
import {
  ACTIVITY_RECENT_LIMIT_DEFAULT,
  dedupeCoEmittedCompleted,
  hydrateActivityEvents,
  loadRecentActivity,
} from "@/lib/activity-feed";
import { RecentActivityRailClient } from "./recent-activity-rail-client";

interface RecentActivityRailProps {
  /** Authenticated user id. Caller pre-resolves auth + workspace so the
   *  rail can render inline alongside the dashboard's other RSC widgets
   *  without a duplicate `auth()` lookup. */
  userId: string;
  /** Active workspace id, or null when the user is unbootstrapped. */
  workspaceId: string | null;
  /** Override the default 6-row cap (e.g. for tighter density on a
   *  side rail). Clamped at the API/lib layer too. */
  limit?: number;
}

/**
 * "Recent activity" rail for the dashboard home (US3 + US5).
 *
 * Server-renders the latest N events the user is entitled to see (union
 * of For-you + My-brands + Workspace, plus any events on assets the user
 * created — same union as `loadForYouTab`, so the rail is a strict
 * superset of what the user could find by clicking through to /activity).
 *
 * The visible rendering + polling lives in the client wrapper
 * (`<RecentActivityRailClient>` — US5 / T081). We chose the
 * "server-fetches-initial-data, client-polls" boundary over
 * `router.refresh()` because that would re-render every server widget on
 * the dashboard on each tick (≈6 DB roundtrips); polling just the rail
 * pays 1 query / 45s instead.
 *
 * Click-through targets and visibility rules are inherited from
 * `<ActivityRow>` so the rail stays trivially in sync with the page when
 * either evolves.
 */
export async function RecentActivityRail({
  userId,
  workspaceId,
  limit = ACTIVITY_RECENT_LIMIT_DEFAULT,
}: RecentActivityRailProps) {
  if (!workspaceId) {
    return <RecentActivityRailClient initialItems={[]} limit={limit} />;
  }

  // Fetch 2× headroom so the dedupe filter (image+video gen co-emit
  // suppression) doesn't shrink the rail below the requested cap. Same
  // reasoning + bound as the /api/activity/recent route.
  const raw = await loadRecentActivity({
    userId,
    workspaceId,
    limit: limit * 2,
  });

  const hydrated = await hydrateActivityEvents(raw, {
    getThumbnailUrl: (key) => getAssetUrl(key),
  });
  const items = dedupeCoEmittedCompleted(hydrated).slice(0, limit);

  return <RecentActivityRailClient initialItems={items} limit={limit} />;
}

/**
 * Loading fallback — re-uses the row skeleton's compact variant + the
 * rail's own header chrome (incl. the ArrowRight glyph) so first paint
 * matches the final shape exactly. No layout shift on hydrate.
 *
 * Stays a server component (no client JS for the loading state).
 */
export function RecentActivityRailSkeleton() {
  return (
    <section
      aria-label="Recent activity"
      className="rounded-xl border border-border/60 bg-card"
    >
      <header className="flex items-center justify-between p-4">
        <h2 className="font-heading text-sm font-semibold tracking-tight text-foreground">
          Recent activity
        </h2>
        {/* Mirror the resolved header exactly — including the ArrowRight
            glyph — so the View-all label doesn't horizontally shift on
            hydrate. We render a non-interactive Link here too so the
            focus-visible affordance is identical between skeleton + real;
            the Suspense boundary above will swap us out before the user
            could realistically tab to it. */}
        <Link
          href="/activity"
          className="group inline-flex items-center gap-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          View all
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      </header>
      <div className="border-t border-border/60">
        <ActivitySkeleton count={6} variant="compact" />
      </div>
    </section>
  );
}
