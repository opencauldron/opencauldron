/**
 * GET /api/activity/recent?limit=10
 *
 * Returns the most-recent N events the user is entitled to see in their
 * active workspace — the *union* of For-you + My-brands + Workspace tabs.
 * Used by the dashboard "Recent activity" rail (US3).
 *
 * Workspace scoping is enforced server-side (NFR-004). The same co-emit
 * dedupe applied at `/api/activity` (Phase 4 / QA-flagged from Phase 3) is
 * applied here too so the rail and the page show consistent rows for the
 * image+video gen flows.
 *
 * Response: `{ items: HydratedActivityEvent[] }` — no cursor; the rail is
 * fixed-size and "View all" links to /activity for deeper browsing.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import { getAssetUrl } from "@/lib/storage";
import {
  ACTIVITY_RECENT_LIMIT_DEFAULT,
  ACTIVITY_RECENT_LIMIT_MAX,
  dedupeCoEmittedCompleted,
  hydrateActivityEvents,
  loadRecentActivity,
} from "@/lib/activity-feed";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getCurrentWorkspace(session.user.id);
  if (!workspace) {
    // Match the notifications + /api/activity routes — empty list (not 404)
    // for unbootstrapped users so the UI renders an empty rail cleanly.
    return NextResponse.json({ items: [] });
  }

  const limit = parseLimit(req.nextUrl.searchParams.get("limit"));
  // Fetch a few extra so the dedupe filter can drop co-emitted .completed
  // rows and we still hit the requested limit. The dedupe is bounded to
  // (created.assetId === completed.metadata.assetId) so the worst-case
  // shrink is 1:1 — fetching 2× headroom is plenty.
  const fetchLimit = Math.min(limit * 2, ACTIVITY_RECENT_LIMIT_MAX * 2);

  const raw = await loadRecentActivity({
    userId: session.user.id,
    workspaceId: workspace.id,
    limit: fetchLimit,
  });

  const hydrated = await hydrateActivityEvents(raw, {
    getThumbnailUrl: (key) => getAssetUrl(key),
  });
  const items = dedupeCoEmittedCompleted(hydrated).slice(0, limit);

  return NextResponse.json({ items });
}

function parseLimit(value: string | null): number {
  if (!value) return ACTIVITY_RECENT_LIMIT_DEFAULT;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return ACTIVITY_RECENT_LIMIT_DEFAULT;
  return Math.min(n, ACTIVITY_RECENT_LIMIT_MAX);
}
