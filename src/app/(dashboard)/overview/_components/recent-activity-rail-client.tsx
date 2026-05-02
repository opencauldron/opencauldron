"use client";

/**
 * Client wrapper for the dashboard "Recent activity" rail (US5 / T081).
 *
 * Polling boundary: this component owns the `useFocusAndIntervalRefetch`
 * hook and the items state. The server component (`<RecentActivityRail>`)
 * still does the initial data fetch + hydration so first paint is
 * server-rendered (no client-side waterfall on the dashboard's most-glanced
 * widget).
 *
 * Why client-only here vs. `router.refresh()`: refreshing the page would
 * re-render every server component on the dashboard (4 widgets + the
 * action strip + the personal-stats widget), each with its own DB
 * roundtrip. Polling just the rail's data fetch is the right boundary —
 * we pay 1 query / 45s instead of ~6.
 *
 * Refetch semantics match `<ActivityFeed>`:
 *   - Same head id  → no state update (US5 AC #4 — no jitter).
 *   - New events    → prepend in arrival order, deduped by id, then trim
 *                     back to `limit` so the rail doesn't grow unbounded.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ActivityRow } from "@/app/(dashboard)/activity/_components/activity-row";
import { useFocusAndIntervalRefetch } from "@/hooks/use-focus-and-interval-refetch";
import {
  type HydratedActivityEvent,
  mergeHeadRefetch,
} from "@/lib/activity-feed-types";

interface RecentActivityRailClientProps {
  initialItems: HydratedActivityEvent[];
  /** Max rows to display. Polling fetches `limit`-many; the API does the
   *  same dedupe + trim the server component does, so the client doesn't
   *  need to over-fetch. */
  limit: number;
}

export function RecentActivityRailClient({
  initialItems,
  limit,
}: RecentActivityRailClientProps) {
  const [items, setItems] = useState(initialItems);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/activity/recent?limit=${limit}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { items: HydratedActivityEvent[] };
      // Pure merge — same-head-id returns prev reference so React skips
      // the re-render (US5 AC #4 / no-jitter). Trims back to `limit` so
      // the rail doesn't grow unbounded as new events arrive.
      setItems((prev) => mergeHeadRefetch(prev, data.items, limit));
    } catch {
      // Silent on polling errors — the rail stays on the last known data.
    }
  }, [limit]);

  useFocusAndIntervalRefetch({ refetch });

  return <RailShell items={items} />;
}

function RailShell({ items }: { items: HydratedActivityEvent[] }) {
  // Container styling matches the peer Widget components on this page
  // (border + border-border/60), not the /activity page's ring treatment.
  // Page-level consistency wins.
  return (
    <section
      aria-label="Recent activity"
      className="rounded-xl border border-border/60 bg-card"
    >
      {/* No `border-b` on the header — peer widgets just use padding to
          create the gap. The first row's `border-t` (below) covers the
          divider role since `divide-y` doesn't draw a top border. */}
      <header className="flex items-center justify-between p-4">
        <h2 className="font-heading text-sm font-semibold tracking-tight text-foreground">
          Recent activity
        </h2>
        <Link
          href="/activity"
          className="group inline-flex items-center gap-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          View all
          <ArrowRight
            className="size-3 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
      </header>

      {items.length === 0 ? (
        <RailEmpty />
      ) : (
        <ul
          role="list"
          className="divide-y divide-border/60 border-t border-border/60"
        >
          {items.map((event) => (
            <ActivityRow key={event.id} event={event} variant="compact" />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Compact empty state — single line, action-oriented. Doesn't repeat the
 * page-level `<ActivityEmpty>`'s "brewing" line (we use one project verb
 * per surface, max).
 */
function RailEmpty() {
  return (
    <div className="border-t border-border/60 px-4 py-8 text-center">
      <p className="text-sm text-muted-foreground">
        Nothing yet. Generate something to fill your feed.
      </p>
    </div>
  );
}
