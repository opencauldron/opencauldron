"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellDot, ChevronRight, Inbox } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  NotificationRow,
  type Notification,
} from "@/components/notification-row";

const API_LIST = "/api/notifications";
const API_READ_ALL = "/api/notifications/read-all";
const apiReadOne = (id: string) =>
  `/api/notifications/${encodeURIComponent(id)}/read`;

type ListResponse = {
  items: Notification[];
  unreadCount: number;
};

/**
 * Format the unread badge: 1–9 render verbatim, 10+ collapse to `9+` so the
 * pill never grows wide enough to crowd the bell icon.
 */
function formatBadge(n: number): string {
  if (n <= 0) return "";
  if (n > 9) return "9+";
  return String(n);
}

export function NotificationsMenuItem() {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setHasError(false);
    try {
      const res = await fetch(API_LIST, { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as ListResponse;
      setItems(Array.isArray(data.items) ? data.items.slice(0, 20) : []);
      setUnreadCount(typeof data.unreadCount === "number" ? data.unreadCount : 0);
    } catch {
      setItems([]);
      setUnreadCount(0);
      setHasError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load so the badge count is accurate before the popover opens.
  useEffect(() => {
    load();
  }, [load]);

  // Refetch every time the popover opens — cheap, and gives the user a
  // freshly-current list every interaction without us having to invalidate.
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) load();
  };

  /**
   * Optimistic mark-all-read. We zero the count + flip every row's readAt
   * locally before the POST so the popover reflects the user's intent
   * instantly. If the request fails we silently restore — a transient mark-
   * read failure isn't worth a toast (the next refetch will reconcile).
   */
  const markAllRead = async () => {
    if (unreadCount === 0) return;
    const nowIso = new Date().toISOString();
    const previous = { items, unreadCount };
    setItems((prev) =>
      prev.map((i) => (i.readAt ? i : { ...i, readAt: nowIso }))
    );
    setUnreadCount(0);
    try {
      const res = await fetch(API_READ_ALL, { method: "POST" });
      if (!res.ok) throw new Error("read-all failed");
    } catch {
      setItems(previous.items);
      setUnreadCount(previous.unreadCount);
    }
  };

  /**
   * Mark a single notification read when the user clicks it. Optimistic so
   * the unread accent disappears the moment they navigate away.
   */
  const markOneRead = async (n: Notification) => {
    if (n.readAt) return;
    const nowIso = new Date().toISOString();
    setItems((prev) =>
      prev.map((i) => (i.id === n.id ? { ...i, readAt: nowIso } : i))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await fetch(apiReadOne(n.id), { method: "POST" });
    } catch {
      // Silent — the next refetch will reconcile.
    }
  };

  const hasUnread = unreadCount > 0;
  const BellGlyph = hasUnread ? BellDot : Bell;

  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <SidebarMenuButton
              isActive={open}
              tooltip={
                isCollapsed
                  ? hasUnread
                    ? `Notifications (${unreadCount} unread)`
                    : "Notifications"
                  : undefined
              }
              className={`group/nav border-l-2 transition-all duration-200 hover:translate-x-0.5 ${
                open
                  ? "border-primary/60 bg-sidebar-accent text-foreground"
                  : "border-transparent"
              }`}
            />
          }
        >
          {/* Bell glyph wrapper. In collapsed mode we surface unread state
              via a ping dot (matching WhatsNew). In expanded mode we don't
              double-up — the numeric pill on the right does the work. */}
          <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
            <BellGlyph
              className={`h-4 w-4 transition-colors duration-200 ${
                open
                  ? "text-primary"
                  : "text-muted-foreground group-hover/nav:text-foreground"
              }`}
              strokeWidth={1.75}
            />
            {hasUnread && isCollapsed && (
              <span
                className="absolute -top-0.5 -right-0.5 flex h-2 w-2"
                aria-hidden
              >
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/70" />
                <span className="relative h-2 w-2 rounded-full bg-primary ring-2 ring-sidebar" />
              </span>
            )}
          </span>
          <span>Notifications</span>
          {/* Expanded-mode unread pill. Uses primary, sits to the left of
              the chevron so the pill aligns vertically with other badges. */}
          {hasUnread && !isCollapsed && (
            <span
              aria-label={`${unreadCount} unread`}
              className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold tabular-nums text-primary-foreground group-data-[collapsible=icon]:hidden"
            >
              {formatBadge(unreadCount)}
            </span>
          )}
          <ChevronRight
            className={`${
              hasUnread ? "ml-1" : "ml-auto"
            } h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[collapsible=icon]:hidden ${
              open ? "translate-x-0.5 text-foreground" : ""
            }`}
          />
        </PopoverTrigger>

        <PopoverContent
          side="right"
          align={isCollapsed ? "center" : "end"}
          sideOffset={isCollapsed ? 8 : 12}
          className="w-96 gap-0 border-sidebar-border bg-sidebar p-0 ring-sidebar-border/60"
        >
          {/* Header bar — mirrors WhatsNew's. Label on the left, action
              on the right. The action is a tiny text button that disables
              when there's nothing to mark. */}
          <div className="flex items-center justify-between border-b border-sidebar-border/60 px-3 pt-3 pb-2">
            <div className="flex items-baseline gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Notifications
              </div>
              {hasUnread && (
                <span className="text-[10px] font-medium uppercase tracking-wider text-primary/80">
                  {unreadCount} new
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={markAllRead}
              disabled={!hasUnread}
              className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              Mark all read
            </button>
          </div>

          {/* Body — scrolls within max-h. The list, loading, and empty
              states all share the same vertical rhythm so transitioning
              between them never causes a layout jolt. */}
          <div className="max-h-[26rem] overflow-y-auto px-1.5 py-1.5">
            {loading && items.length === 0 ? (
              <SkeletonList />
            ) : items.length === 0 ? (
              <EmptyState errored={hasError} />
            ) : (
              <ol className="flex flex-col gap-0.5">
                {items.slice(0, 20).map((n) => (
                  <li key={n.id}>
                    <NotificationRow
                      notification={n}
                      onSelect={(picked) => {
                        markOneRead(picked);
                        setOpen(false);
                      }}
                    />
                  </li>
                ))}
              </ol>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}

/**
 * Skeleton rows used during the very first load. Geometry matches a real row
 * (avatar size, text column widths, time slot) so the swap to real data is
 * imperceptible.
 */
function SkeletonList() {
  return (
    <ol className="flex flex-col gap-0.5" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <li
          key={i}
          className="flex items-start gap-3 rounded-md border-l-2 border-transparent px-2.5 py-2"
        >
          <div className="size-7 shrink-0 animate-pulse rounded-full bg-sidebar-accent/60" />
          <div className="flex-1 space-y-1.5">
            <div
              className="h-3 animate-pulse rounded bg-sidebar-accent/60"
              style={{ width: `${70 - i * 6}%` }}
            />
            <div
              className="h-2.5 animate-pulse rounded bg-sidebar-accent/40"
              style={{ width: `${40 + i * 4}%` }}
            />
          </div>
          <div className="mt-0.5 h-2.5 w-6 animate-pulse rounded bg-sidebar-accent/40" />
        </li>
      ))}
    </ol>
  );
}

function EmptyState({ errored }: { errored: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sidebar-accent/60 ring-1 ring-sidebar-border/60">
        <Inbox
          className="h-5 w-5 text-muted-foreground/70"
          strokeWidth={1.5}
          aria-hidden
        />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground/90">
          {errored ? "Couldn’t load notifications" : "You’re all caught up"}
        </p>
        <p className="text-[11px] text-muted-foreground/70">
          {errored
            ? "Try opening this again in a moment."
            : "New activity will show up here as it happens."}
        </p>
      </div>
    </div>
  );
}
