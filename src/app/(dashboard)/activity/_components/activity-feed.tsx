"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFocusAndIntervalRefetch } from "@/hooks/use-focus-and-interval-refetch";
import {
  ACTIVITY_TAB_VALUES,
  type ActivityTab,
  type HydratedActivityEvent,
  mergeHeadRefetch,
} from "@/lib/activity-feed-types";
import { ActivityRow } from "./activity-row";
import { ActivityEmpty } from "./activity-empty";

const TAB_LABELS: Record<ActivityTab, string> = {
  "for-you": "For you",
  "my-brands": "My brands",
  workspace: "Workspace",
};

interface ActivityFeedProps {
  tab: ActivityTab;
  initialItems: HydratedActivityEvent[];
  initialNextCursor: string | null;
}

/**
 * Tabs + paginated list. Server-renders the first page (passed as
 * `initialItems`); subsequent pages and tab switches go through the client
 * `/api/activity` endpoint.
 *
 * Tab state is the URL — `?tab=for-you|my-brands|workspace` — so a refresh
 * preserves the tab and Back/Forward Just Works. Switching tabs uses
 * `useTransition` so the trigger doesn't lock up while the new page
 * server-renders.
 *
 * "Load more" is the chosen pagination affordance per US1 acceptance
 * criterion 5; we deliberately don't auto-load on scroll in v1 (out of
 * scope for an MVP — adds intersection-observer + jitter risk).
 */
export function ActivityFeed({
  tab,
  initialItems,
  initialNextCursor,
}: ActivityFeedProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Local pagination state. Reset whenever `tab` changes (parent re-mounts
  // via the page's `key={tab}` so this hook resets implicitly — see page.tsx
  // for the key). We still defensively prefer the prop on first render.
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onTabChange = useCallback(
    (next: string) => {
      const value = (next as ActivityTab) ?? "for-you";
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("tab", value);
      // Drop the cursor on tab switch — it's bound to a different feed.
      sp.delete("cursor");
      startTransition(() => {
        router.replace(`/activity?${sp.toString()}`);
      });
    },
    [router, searchParams]
  );

  /**
   * US6 — propagate the active filter set into every API call so polling
   * + load-more honor the same chips/since the page server-rendered.
   * `searchParams` is the live URL state from `useSearchParams()`; the
   * client never holds filter state separately.
   */
  const filterQs = useMemo(() => {
    const qs = new URLSearchParams();
    const chips = searchParams.get("chips");
    const since = searchParams.get("since");
    if (chips) qs.set("chips", chips);
    if (since) qs.set("since", since);
    const out = qs.toString();
    return out ? `&${out}` : "";
  }, [searchParams]);

  const onLoadMore = useCallback(async () => {
    if (!nextCursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/activity?tab=${encodeURIComponent(tab)}&cursor=${encodeURIComponent(nextCursor)}${filterQs}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = (await res.json()) as {
        items: HydratedActivityEvent[];
        nextCursor: string | null;
      };
      setItems((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load more activity");
    } finally {
      setLoading(false);
    }
  }, [nextCursor, loading, tab, filterQs]);

  /**
   * US5 — focus + interval refetch for the head cursor.
   *
   * Only the FIRST page (no cursor) is refetched. Loaded pages stay loaded
   * — we never blow away the user's scroll context. If the head id matches
   * what's currently first in `items`, we skip the state update entirely
   * (US5 AC #4 — no jitter when there's nothing new). Otherwise new events
   * are prepended in arrival order, deduped against existing item ids.
   *
   * Filters (US6): poll the SAME filter set the page is currently showing.
   */
  const refetchHead = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/activity?tab=${encodeURIComponent(tab)}${filterQs}`,
        { cache: "no-store" }
      );
      if (!res.ok) return; // silent — don't surface polling errors
      const data = (await res.json()) as {
        items: HydratedActivityEvent[];
        nextCursor: string | null;
      };
      // Pure merge in `mergeHeadRefetch` — same-head-id returns the prev
      // reference so React skips the re-render (US5 AC #4 / no-jitter).
      // No `maxItems` here: loaded pages stay loaded; we only prepend.
      setItems((prev) => mergeHeadRefetch(prev, data.items));
    } catch {
      // Silent on network blips — the user can still load more by hand.
    }
  }, [tab, filterQs]);

  useFocusAndIntervalRefetch({ refetch: refetchHead });

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList variant="line" aria-label="Activity tabs">
          {ACTIVITY_TAB_VALUES.map((t) => (
            <TabsTrigger key={t} value={t} disabled={isPending && tab !== t}>
              {TAB_LABELS[t]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="rounded-xl bg-card ring-1 ring-foreground/10">
        {items.length === 0 ? (
          <ActivityEmpty variant={tab} />
        ) : (
          <ul role="list" className="divide-y divide-border/60">
            {items.map((event) => (
              <ActivityRow key={event.id} event={event} />
            ))}
          </ul>
        )}
        {nextCursor && items.length > 0 ? (
          <div className="flex items-center justify-center border-t border-border/60 px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onLoadMore}
              disabled={loading}
              className="text-muted-foreground"
            >
              {loading ? (
                <>
                  <Loader2
                    className="mr-2 size-3.5 animate-spin"
                    aria-hidden
                  />
                  Loading…
                </>
              ) : (
                "Load more"
              )}
            </Button>
          </div>
        ) : null}
        {error ? (
          <p
            role="status"
            aria-live="polite"
            className="border-t border-border/60 px-4 py-3 text-center text-xs text-destructive"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
