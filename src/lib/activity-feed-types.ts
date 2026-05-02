/**
 * Activity feed types + constants — client-safe.
 *
 * Why this file exists separately from `activity-feed.ts`: the latter
 * imports the drizzle DB handle (transitively pulls in `pg` → `node:dns`),
 * which the bundler can't resolve at the client boundary. Splitting the
 * pure types + constants here lets client components import what they
 * need without dragging the whole DB graph into the browser bundle.
 *
 * Server modules import from `activity-feed.ts`; client modules import
 * from `activity-feed-types.ts`. The route handler (server) imports from
 * the heavy module; the client `<ActivityFeed>` imports from this one.
 *
 * Cursor encode/decode lives in `activity-feed.ts` because it uses
 * `Buffer` (node-only). The client never encodes a cursor — it just
 * round-trips the opaque token from `nextCursor` back into the next
 * `?cursor=` query string.
 */

import type { ActivityVerb, ActivityVisibility } from "@/lib/activity";

export type ActivityTab = "for-you" | "my-brands" | "workspace";

export const ACTIVITY_TAB_VALUES: readonly ActivityTab[] = [
  "for-you",
  "my-brands",
  "workspace",
] as const;

export const ACTIVITY_LIMIT_DEFAULT = 50;
export const ACTIVITY_LIMIT_MAX = 100;

// ---------------------------------------------------------------------------
// US6 / Phase 8 — filter chips + time-window
// ---------------------------------------------------------------------------

/**
 * Verb chip groups (US6 / T090). Each chip aggregates one or more raw verbs
 * into a user-meaningful label. Chip IDs (NOT raw verb strings) live in the
 * URL so links are short, stable across verb renames, and don't leak the
 * verb taxonomy to the public.
 *
 * Resolution: chip → verb[] happens server-side in the API route so the
 * client sends compact `?chips=approvals,feats` rather than the verbose
 * `?verbs=generation.approved,generation.rejected,…`. The resolver lives
 * in this module (`resolveChipsToVerbs`) so client + server share one
 * source of truth.
 */
export type ActivityChip =
  | "approvals"      // generation.{submitted,approved,rejected}
  | "drafts"         // generation.{created,completed}
  | "feats"          // member.earned_feat
  | "level-ups";     // member.leveled_up

export const ACTIVITY_CHIP_VALUES: readonly ActivityChip[] = [
  "approvals",
  "drafts",
  "feats",
  "level-ups",
] as const;

/** UI labels for each chip — kept here so URL-id parsing + UI can't drift. */
export const ACTIVITY_CHIP_LABELS: Record<ActivityChip, string> = {
  approvals: "Reviews",
  drafts: "Drafts",
  feats: "Feats",
  "level-ups": "Level-ups",
};

const CHIP_TO_VERBS: Record<ActivityChip, readonly ActivityVerb[]> = {
  approvals: [
    "generation.submitted",
    "generation.approved",
    "generation.rejected",
  ],
  drafts: ["generation.created", "generation.completed"],
  feats: ["member.earned_feat"],
  "level-ups": ["member.leveled_up"],
};

/**
 * Resolve a list of chip IDs to the underlying verb set (deduped). Returns
 * an empty array when no chips are passed — callers interpret that as "no
 * verb filter," NOT "match nothing." Unknown chip IDs are silently dropped
 * (URL-tampering safety).
 */
export function resolveChipsToVerbs(chips: readonly string[]): ActivityVerb[] {
  const out = new Set<ActivityVerb>();
  for (const chip of chips) {
    const verbs = CHIP_TO_VERBS[chip as ActivityChip];
    if (!verbs) continue;
    for (const v of verbs) out.add(v);
  }
  return [...out];
}

/** Time-window options. `all` means no `since` filter at all. */
export type ActivitySince = "today" | "7d" | "30d" | "all";

export const ACTIVITY_SINCE_VALUES: readonly ActivitySince[] = [
  "today",
  "7d",
  "30d",
  "all",
] as const;

export const ACTIVITY_SINCE_LABELS: Record<ActivitySince, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
};

/**
 * Resolve a since-token to the absolute lower bound `Date` (inclusive).
 * Returns `null` for `"all"` (no lower bound). `"today"` is interpreted as
 * "since UTC midnight today" — the rail/page render with UTC timestamps so
 * day-boundary expectations are predictable across TZs (the QA verdict for
 * Phase 6 is the cautionary tale here).
 *
 * `now` is injectable for tests.
 */
export function resolveSince(
  since: string | null | undefined,
  now: Date = new Date()
): Date | null {
  switch (since) {
    case "today": {
      // UTC midnight of `now`'s date. Avoids local-TZ surprises.
      const d = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      );
      return d;
    }
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "all":
    case null:
    case undefined:
    case "":
      return null;
    default:
      // Unknown token → no filter (URL-tampering safety; matches chip behavior).
      return null;
  }
}

/** Hydrated event surfaced to the UI. Discriminated by `objectType`. */
export interface HydratedActivityEvent {
  id: string;
  createdAt: string; // ISO
  verb: ActivityVerb;
  visibility: ActivityVisibility;
  brandId: string | null;
  /** The actor — always present (FK NOT NULL on activity_events.actor_id). */
  actor: HydratedActor;
  /** The brand context, if the event is brand-scoped. Null for workspace
   *  / private events without a brand. */
  brand: HydratedBrand | null;
  /** The polymorphic target. Discriminated by `objectType`. */
  object: HydratedObject;
  metadata: Record<string, unknown>;
  /** Click-through href to the canonical detail surface. Null when no
   *  detail exists (e.g. a feat without a profile page). */
  href: string | null;
}

export interface HydratedActor {
  id: string;
  name: string | null;
  image: string | null;
}

export interface HydratedBrand {
  id: string;
  name: string;
  slug: string | null;
  isPersonal: boolean;
}

export type HydratedObject =
  | {
      type: "asset";
      id: string;
      prompt: string | null;
      thumbnailUrl: string | null;
      mediaType: "image" | "video";
      status: string;
    }
  | {
      type: "user";
      id: string;
      name: string | null;
      image: string | null;
    }
  | {
      type: "feat";
      id: string; // text slug, e.g. 'first-brew'
      name: string;
      icon: string;
    }
  | {
      type: "generation";
      id: string;
      assetId: string | null;
      prompt: string | null;
      thumbnailUrl: string | null;
      mediaType: "image" | "video" | null;
    }
  | {
      type: "unknown";
      id: string;
    };

export interface ActivityCursor {
  createdAt: string; // ISO
  id: string;
}

/**
 * Merge a head-refetch response into the loaded items list (US5 / T081).
 *
 * Three cases:
 *  1. Same head id     → return `prev` reference (no React re-render).
 *  2. Net-new events   → prepend in arrival order, dedupe by id.
 *  3. No new events    → return `prev` reference.
 *
 * `maxItems` (optional) trims the merged list back to a cap — used by the
 * dashboard rail to keep its row count bounded. Omit for the full-page feed
 * where loaded pages stay loaded.
 *
 * Pure function — no React, no IO. Tested directly in
 * `tests/unit/use-focus-and-interval-refetch.test.ts`.
 */
export function mergeHeadRefetch(
  prev: HydratedActivityEvent[],
  fresh: HydratedActivityEvent[],
  maxItems?: number
): HydratedActivityEvent[] {
  // Case 1 — same head id, no change.
  if (prev.length > 0 && fresh.length > 0 && prev[0].id === fresh[0].id) {
    return prev;
  }
  const known = new Set(prev.map((e) => e.id));
  const novel = fresh.filter((e) => !known.has(e.id));
  // Case 3 — fresh is empty or fully overlaps prev.
  if (novel.length === 0) return prev;
  // Case 2 — prepend, then trim if a cap was passed.
  const merged = [...novel, ...prev];
  return typeof maxItems === "number" ? merged.slice(0, maxItems) : merged;
}
