"use client";

import Link from "next/link";
import Image from "next/image";
import {
  Award,
  Check,
  CheckCircle2,
  Sparkles,
  Trophy,
  Upload,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatRelativeTime } from "@/lib/relative-time";
import type {
  HydratedActivityEvent,
  HydratedObject,
} from "@/lib/activity-feed-types";
import type { ActivityVerb } from "@/lib/activity";

/**
 * Per-verb glyph + the action phrase that goes after the actor name. Keeps
 * the row content uniform: avatar — actor — verb-phrase — object — time.
 *
 * Tints sit in the muted/primary family deliberately. The activity feed is
 * a quiet ambient surface; we don't want a riot of colors competing with
 * the workspace's brand chrome. Approve / reject get a single accent each
 * (emerald / rose) because they communicate state.
 */
const VERB_META: Record<
  ActivityVerb,
  { Icon: LucideIcon; phrase: string; tint: string }
> = {
  "generation.created": {
    Icon: Sparkles,
    phrase: "created",
    tint: "text-muted-foreground",
  },
  "generation.submitted": {
    Icon: Upload,
    phrase: "submitted",
    tint: "text-muted-foreground",
  },
  "generation.approved": {
    Icon: CheckCircle2,
    phrase: "approved",
    tint: "text-emerald-500",
  },
  "generation.rejected": {
    Icon: XCircle,
    phrase: "rejected",
    tint: "text-rose-500",
  },
  "generation.completed": {
    Icon: Check,
    phrase: "completed",
    tint: "text-muted-foreground",
  },
  "member.earned_feat": {
    Icon: Award,
    phrase: "earned a feat",
    tint: "text-primary",
  },
  "member.leveled_up": {
    Icon: Trophy,
    phrase: "leveled up",
    tint: "text-primary",
  },
};

function getInitials(name: string | null | undefined): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

interface ActivityRowProps {
  event: HydratedActivityEvent;
  /** Compact variant — used by the dashboard rail (T061). Tighter padding,
   *  no thumbnail. */
  variant?: "default" | "compact";
}

/**
 * Single activity row.
 *
 * Layout (default): avatar (with verb-pip overlay) — body text — optional
 * object preview thumbnail — relative time. Whole row is a Link when
 * `event.href` is set, otherwise a plain `<div>` so we never produce broken
 * anchors.
 *
 * The row uses `<article>` semantics + `<time datetime>` per a11y guidelines
 * (NFR-006); the parent list wraps these in a `<ul role="list">`.
 */
export function ActivityRow({ event, variant = "default" }: ActivityRowProps) {
  const meta = VERB_META[event.verb];
  const initials = getInitials(event.actor.name);
  const actorName = event.actor.name ?? "Someone";
  const compact = variant === "compact";

  // Row contents — same layout regardless of whether the wrapper is a Link
  // or a plain article. The wrapper applies layout/hover/focus classes.
  const body = (
    <>
      {/* Avatar + verb pip. Pip identifies the verb without extra label
          chrome; mirrors the notifications row pattern but with our own
          verb→glyph mapping. */}
      <div className="relative shrink-0 pt-0.5">
        <Avatar size="sm" className={compact ? "size-7" : "size-8"}>
          {event.actor.image ? (
            <AvatarImage src={event.actor.image} alt={actorName} />
          ) : null}
          <AvatarFallback className="bg-muted text-[10px] font-medium text-muted-foreground">
            {initials || (
              <meta.Icon
                className="h-3.5 w-3.5"
                strokeWidth={1.75}
                aria-hidden
              />
            )}
          </AvatarFallback>
        </Avatar>
        {/* Pip ring uses surface-agnostic `ring-foreground/10` so the row's
            hover background swap (bg-accent/50) doesn't create a halo
            mismatch against `bg-card`. */}
        <span
          className="absolute -right-0.5 -bottom-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-card ring-2 ring-foreground/10"
          aria-hidden
        >
          <meta.Icon
            className={`h-2.5 w-2.5 ${meta.tint}`}
            strokeWidth={2.25}
          />
        </span>
      </div>

      {/* Body — actor + verb phrase + object phrase + (optional) brand tag.
          Reads like a sentence so the eye scans a vertical list naturally. */}
      <div className="min-w-0 flex-1">
        <p
          className={`leading-snug ${
            compact ? "text-[13px]" : "text-sm"
          } text-muted-foreground`}
        >
          <span className="font-medium text-foreground">{actorName}</span>{" "}
          {meta.phrase}{" "}
          <ObjectPhrase event={event} />
          <BrandSuffix event={event} />
        </p>
        {event.verb === "generation.rejected" &&
        typeof event.metadata.note === "string" &&
        event.metadata.note.trim().length > 0 ? (
          // Compact variant clamps to one line so a rejection note doesn't
          // inflate a single-row activity into 3 lines on the dashboard rail.
          <p
            className={`mt-1 border-l border-destructive/30 pl-2 text-[12px] italic text-muted-foreground/80 ${
              compact ? "line-clamp-1" : "line-clamp-2"
            }`}
            title={event.metadata.note as string}
          >
            {event.metadata.note as string}
          </p>
        ) : null}
      </div>

      {/* Object preview thumbnail — only on the default variant, only for
          objects that actually have one. Compact variant skips this to keep
          the dashboard rail dense. */}
      {compact ? null : <ObjectPreview object={event.object} />}

      {/* Relative time — `<time datetime>` per a11y. Tabular-nums keeps the
          right edge stable as the value flips between "5m" and "Yesterday". */}
      {/* `text-muted-foreground` (no /60) for WCAG AA — at 10px against
          bg-card and the bg-accent/50 hover surface, the /60 variant came
          in at ~3.0:1 (fail). The full token sits well above 4.5:1 on
          both surfaces. */}
      <time
        dateTime={event.createdAt}
        className="mt-0.5 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground tabular-nums"
        title={new Date(event.createdAt).toLocaleString()}
      >
        {formatRelativeTime(event.createdAt)}
      </time>
    </>
  );

  // Layout shell. Project-wide global transitions handle interactive color
  // changes (per design-system skill — `0.15s ease`); we don't re-add
  // `transition-colors` here. Compact variant uses tighter padding so the
  // dashboard rail stays dense (no thumbnail to balance against).
  const shellClasses = compact
    ? "group/activity relative flex w-full items-start gap-3 px-4 py-2 hover:bg-accent/50 cursor-pointer"
    : "group/activity relative flex w-full items-start gap-3 px-4 py-3 hover:bg-accent/50 cursor-pointer";

  if (event.href) {
    return (
      <li>
        <Link href={event.href} prefetch={false} className={shellClasses}>
          {body}
        </Link>
      </li>
    );
  }

  // No detail target — should be rare after the spec-compliance fix routed
  // feats to /profile/<actorId>; we keep this branch as a safety net for the
  // hydrator's `unknown` object type. Make the row keyboard-reachable so
  // Tab order doesn't skip dead rows (NFR-006).
  return (
    <li>
      <article
        tabIndex={0}
        className={shellClasses + " cursor-default hover:bg-transparent"}
      >
        {body}
      </article>
    </li>
  );
}

/**
 * The object-phrase fragment (the noun the actor's verb attaches to). Picks
 * a sensible label per object type; falls back to the verb's natural object.
 */
function ObjectPhrase({ event }: { event: HydratedActivityEvent }) {
  const o = event.object;
  switch (o.type) {
    case "asset":
      return (
        <span className="text-foreground/90">
          {summarize(o.prompt) || "an asset"}
        </span>
      );
    case "generation":
      return (
        <span className="text-foreground/90">
          {summarize(o.prompt) || "a generation"}
        </span>
      );
    case "feat":
      return (
        <span className="text-foreground/90">
          the <span className="font-medium">{o.name}</span> feat
        </span>
      );
    case "user":
      // Level-ups: "leveled up to {title}" (or "to level N" if the metadata
      // didn't carry one — back-compat).
      if (event.verb === "member.leveled_up") {
        const level =
          typeof event.metadata.level === "number"
            ? (event.metadata.level as number)
            : null;
        const title =
          typeof event.metadata.title === "string"
            ? (event.metadata.title as string)
            : null;
        return (
          <>
            to{" "}
            <span className="font-medium text-foreground">
              {title ?? (level !== null ? `level ${level}` : "the next level")}
            </span>
          </>
        );
      }
      return null;
    case "unknown":
      return <span className="text-foreground/90">an item</span>;
  }
}

/**
 * Optional brand suffix — "in <BrandName>" — appended for brand-scoped
 * events with a real brand context. Personal brands and workspace events
 * skip this to avoid noise.
 */
function BrandSuffix({ event }: { event: HydratedActivityEvent }) {
  if (!event.brand || event.brand.isPersonal) return null;
  if (event.visibility !== "brand") return null;
  return (
    <>
      {" "}
      in{" "}
      <span className="text-foreground/90">{event.brand.name}</span>
    </>
  );
}

/** Right-aligned thumbnail. Auto-clipped to rounded square. */
function ObjectPreview({ object }: { object: HydratedObject }) {
  if (object.type === "asset" && object.thumbnailUrl) {
    return (
      <div className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10">
        <Image
          src={object.thumbnailUrl}
          alt={object.prompt ?? ""}
          fill
          sizes="40px"
          className="object-cover"
          unoptimized
        />
      </div>
    );
  }
  if (object.type === "generation" && object.thumbnailUrl) {
    return (
      <div className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10">
        <Image
          src={object.thumbnailUrl}
          alt={object.prompt ?? ""}
          fill
          sizes="40px"
          className="object-cover"
          unoptimized
        />
      </div>
    );
  }
  if (object.type === "feat") {
    // Lucide icon name as a label glyph in lieu of a thumbnail. We don't
    // dynamically resolve the lucide icon at runtime to avoid pulling the
    // whole library bundle; the verb-pip already hints "this is a feat".
    // Tinted fill follows design system rule: `bg-primary/15 text-primary`
    // is the canonical brand-tint pattern (see progress.md T003 setup notes).
    return (
      <div
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"
      >
        <Award className="size-5" strokeWidth={1.75} />
      </div>
    );
  }
  return null;
}

function summarize(text: string | null, max = 70): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1) + "…";
}
