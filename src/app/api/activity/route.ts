/**
 * GET /api/activity?tab=for-you|my-brands|workspace&cursor=...&limit=...
 *                  &chips=approvals,feats&since=today|7d|30d|all
 *
 * Returns a hydrated, paginated activity feed for the current user in their
 * active workspace. Workspace scoping is enforced server-side — the client
 * never passes a workspace_id (NFR-004). Cursor format: opaque base64url of
 * the trailing row's `(created_at_iso, id)` per FR-007.
 *
 * **US6 filters (Phase 8):**
 *   - `chips`  — comma-separated chip IDs (`approvals` / `drafts` / `feats`
 *                / `level-ups`). Resolved server-side to a deduped verb set.
 *                Unknown chip IDs are silently dropped (URL-tampering safe).
 *                We keep raw verbs OUT of the public URL so verb renames
 *                don't break shared links.
 *   - `since`  — `today` (UTC midnight) / `7d` / `30d` / `all` (default).
 *                Unknown tokens default to `all` (no lower bound).
 *
 * Response:
 *   { items: HydratedActivityEvent[], nextCursor: string | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import { getAssetUrl } from "@/lib/storage";
import {
  ACTIVITY_LIMIT_DEFAULT,
  ACTIVITY_LIMIT_MAX,
  ACTIVITY_TAB_VALUES,
  type ActivityTab,
  decodeActivityCursor,
  dedupeCoEmittedCompleted,
  encodeActivityCursor,
  hydrateActivityEvents,
  loadForYouTab,
  loadMyBrandsTab,
  loadWorkspaceTab,
  type RawActivityRow,
  resolveChipsToVerbs,
  resolveSince,
} from "@/lib/activity-feed";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getCurrentWorkspace(session.user.id);
  if (!workspace) {
    // Match the notifications route: empty list for unbootstrapped users
    // rather than 404 — keeps the UI's first-render path simple.
    return NextResponse.json({ items: [], nextCursor: null });
  }

  const url = req.nextUrl;
  const tab = parseTab(url.searchParams.get("tab"));
  const cursor = url.searchParams.get("cursor");
  const limit = parseLimit(url.searchParams.get("limit"));
  const verbs = resolveChipsToVerbs(parseCsv(url.searchParams.get("chips")));
  const since = resolveSince(url.searchParams.get("since"));

  const decoded = cursor ? decodeActivityCursor(cursor) : null;
  if (cursor && !decoded) {
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }

  // Fetch limit+1 so we can detect the next page without a count query.
  const fetchLimit = limit + 1;

  let raw: RawActivityRow[];
  switch (tab) {
    case "for-you":
      raw = await loadForYouTab({
        userId: session.user.id,
        workspaceId: workspace.id,
        cursor: decoded,
        limit: fetchLimit,
        verbs,
        since,
      });
      break;
    case "my-brands":
      raw = await loadMyBrandsTab({
        userId: session.user.id,
        workspaceId: workspace.id,
        cursor: decoded,
        limit: fetchLimit,
        verbs,
        since,
      });
      break;
    case "workspace":
      raw = await loadWorkspaceTab({
        userId: session.user.id,
        workspaceId: workspace.id,
        cursor: decoded,
        limit: fetchLimit,
        verbs,
        since,
      });
      break;
  }

  const hasMore = raw.length > limit;
  const trimmed = hasMore ? raw.slice(0, limit) : raw;
  const nextCursor = hasMore
    ? encodeActivityCursor({
        createdAt: trimmed[trimmed.length - 1].createdAt.toISOString(),
        id: trimmed[trimmed.length - 1].id,
      })
    : null;

  const hydrated = await hydrateActivityEvents(trimmed, {
    getThumbnailUrl: (key) => getAssetUrl(key),
  });
  // Drop `generation.completed` rows that duplicate a sibling
  // `generation.created` in the same page (QA Phase-3 note → Phase-4
  // requirement). See dedupeCoEmittedCompleted's docstring for the caveat.
  const items = dedupeCoEmittedCompleted(hydrated);

  return NextResponse.json({ items, nextCursor });
}

function parseTab(value: string | null): ActivityTab {
  if (value && (ACTIVITY_TAB_VALUES as readonly string[]).includes(value)) {
    return value as ActivityTab;
  }
  return "for-you";
}

function parseLimit(value: string | null): number {
  if (!value) return ACTIVITY_LIMIT_DEFAULT;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return ACTIVITY_LIMIT_DEFAULT;
  return Math.min(n, ACTIVITY_LIMIT_MAX);
}

/** Split a comma-separated query value into trimmed non-empty tokens. */
function parseCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
