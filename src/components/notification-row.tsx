"use client";

import Link from "next/link";
import {
  AtSign,
  CheckCircle2,
  ClipboardCheck,
  CornerUpLeft,
  Inbox,
  UserPlus,
  Building2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { formatRelativeTime } from "@/lib/relative-time";

export type NotificationType =
  | "asset_submitted"
  | "asset_approved"
  | "asset_rejected"
  | "brand_invite"
  | "workspace_invite"
  | "review_assigned"
  | "thread_mention"
  | "thread_reply";

export type Notification = {
  id: string;
  type: NotificationType;
  payload: {
    assetId?: string;
    brandId?: string;
    brandName?: string;
    assetTitle?: string;
    note?: string;
    /** Thread-mention + thread-reply payload (FR-013, FR-014). */
    threadId?: string;
    messageId?: string;
    parentMessageId?: string;
    snippet?: string;
  };
  href: string | null;
  readAt: string | null;
  createdAt: string;
  actor: {
    id: string;
    name: string | null;
    image: string | null;
  } | null;
};

/**
 * Per-type fallback glyph + tint. Used both for the avatar fallback (when
 * `actor` is null or the actor has no image) and as the small corner pip
 * that overlays the avatar to indicate the *kind* of notification.
 *
 * Tints stay in the muted/primary family — this is a sidebar surface, not a
 * dashboard, so a riot of colors would feel off-brand.
 */
const TYPE_META: Record<
  NotificationType,
  { Icon: LucideIcon; label: string }
> = {
  asset_submitted: { Icon: Inbox, label: "Submitted for review" },
  asset_approved: { Icon: CheckCircle2, label: "Approved" },
  asset_rejected: { Icon: XCircle, label: "Rejected" },
  brand_invite: { Icon: Building2, label: "Brand invite" },
  workspace_invite: { Icon: UserPlus, label: "Workspace invite" },
  review_assigned: { Icon: ClipboardCheck, label: "Review assigned" },
  thread_mention: { Icon: AtSign, label: "Mentioned you" },
  thread_reply: { Icon: CornerUpLeft, label: "Replied to your message" },
};

function getInitials(name: string | null | undefined): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

/**
 * Render the prose for a single notification. Keeps the structure consistent
 * across types (actor — verb — object — context) so the eye can scan a vertical
 * list without re-parsing each row.
 *
 * The actor name renders bold; the rest is regular weight so the row reads
 * like a sentence rather than a UI label-grid.
 */
function NotificationBody({ n }: { n: Notification }) {
  const actorName = n.actor?.name ?? "Someone";
  const assetTitle = n.payload.assetTitle ?? "an asset";
  const brandName = n.payload.brandName ?? "a brand";

  const actor = (
    <span className="font-medium text-foreground">{actorName}</span>
  );
  const asset = (
    <span className="text-foreground/90">{assetTitle}</span>
  );
  const brand = (
    <span className="text-foreground/90">{brandName}</span>
  );

  switch (n.type) {
    case "asset_submitted":
      return (
        <>
          {actor} submitted {asset} for review in {brand}
        </>
      );
    case "asset_approved":
      return (
        <>
          {actor} approved {asset}
        </>
      );
    case "asset_rejected":
      return (
        <>
          {actor} rejected {asset}
        </>
      );
    case "brand_invite":
      return (
        <>
          {actor} added you to {brand}
        </>
      );
    case "workspace_invite":
      return <>{actor} added you to the workspace</>;
    case "review_assigned":
      return (
        <>
          {actor} assigned you a review on {asset}
        </>
      );
    case "thread_mention":
      return (
        <>
          {actor} mentioned you in a thread
        </>
      );
    case "thread_reply":
      return (
        <>
          {actor} replied to your message
        </>
      );
  }
}

interface NotificationRowProps {
  notification: Notification;
  onSelect?: (n: Notification) => void;
}

/**
 * Single notification row.
 *
 * Layout: avatar (with type-pip overlay) — body + optional rejection note —
 * relative time. The whole row is a Link when `href` is set, otherwise a
 * plain `<div>` so we never produce broken anchors.
 *
 * Unread indicator: a 2px primary left border + faint primary tint, mirroring
 * the active-nav treatment elsewhere in the sidebar. No giant dot — this is
 * meant to *feel* unread without shouting.
 */
export function NotificationRow({
  notification,
  onSelect,
}: NotificationRowProps) {
  const { Icon } = TYPE_META[notification.type];
  const unread = notification.readAt === null;
  const initials = getInitials(notification.actor?.name);

  const inner = (
    <div className="flex w-full items-start gap-3">
      {/* Avatar + type pip. The pip identifies the notification *kind*
          (submitted / approved / etc) without needing extra label chrome. */}
      <div className="relative shrink-0 pt-0.5">
        <Avatar size="sm" className="size-7">
          {notification.actor?.image ? (
            <AvatarImage
              src={notification.actor.image}
              alt={notification.actor.name ?? ""}
            />
          ) : null}
          <AvatarFallback className="bg-sidebar-accent text-[10px] font-medium text-muted-foreground">
            {initials || (
              <Icon
                className="h-3.5 w-3.5"
                strokeWidth={1.75}
                aria-hidden
              />
            )}
          </AvatarFallback>
        </Avatar>
        <span
          className="absolute -right-0.5 -bottom-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-sidebar ring-2 ring-sidebar"
          aria-hidden
        >
          <Icon
            className={`h-2.5 w-2.5 ${
              notification.type === "asset_approved"
                ? "text-emerald-500"
                : notification.type === "asset_rejected"
                  ? "text-rose-500"
                  : notification.type === "thread_mention" ||
                      notification.type === "thread_reply"
                    ? "text-primary"
                    : "text-muted-foreground"
            }`}
            strokeWidth={2.25}
          />
        </span>
      </div>

      {/* Body + (optional) quoted snippet. Snippet renders muted + italic so
          it reads as a quoted aside rather than a header. */}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug text-muted-foreground">
          <NotificationBody n={notification} />
        </p>
        {notification.type === "asset_rejected" &&
          notification.payload.note && (
            <p
              className="mt-1 line-clamp-2 border-l border-rose-500/30 pl-2 text-[12px] italic text-muted-foreground/80"
              title={notification.payload.note}
            >
              {notification.payload.note}
            </p>
          )}
        {(notification.type === "thread_mention" ||
          notification.type === "thread_reply") &&
          notification.payload.snippet && (
            <p
              className="mt-1 line-clamp-2 border-l border-primary/30 pl-2 text-[12px] italic text-muted-foreground/80"
              title={notification.payload.snippet}
            >
              {notification.payload.snippet}
            </p>
          )}
      </div>

      {/* Relative time. Tabular-style sizing keeps the right edge stable
          across rows even when the value flips between "5m" and "Yesterday". */}
      <time
        dateTime={notification.createdAt}
        className="mt-0.5 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/60 tabular-nums"
        title={new Date(notification.createdAt).toLocaleString()}
      >
        {formatRelativeTime(notification.createdAt)}
      </time>
    </div>
  );

  // Active states: 2px primary left border + faint tint when unread.
  // Hover: matches the sidebar's hover-translate language.
  const baseClasses =
    "group/notif relative flex w-full items-start gap-3 rounded-md border-l-2 px-2.5 py-2 text-left transition-all duration-150 hover:translate-x-0.5 hover:bg-sidebar-accent";
  const stateClasses = unread
    ? "border-primary/70 bg-primary/[0.04]"
    : "border-transparent";

  if (notification.href) {
    return (
      <Link
        href={notification.href}
        prefetch={false}
        onClick={() => onSelect?.(notification)}
        className={`${baseClasses} ${stateClasses}`}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className={`${baseClasses} ${stateClasses}`}>{inner}</div>
  );
}
