import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import { getAssetUrl } from "@/lib/storage";
import {
  ACTIVITY_LIMIT_DEFAULT,
  ACTIVITY_TAB_VALUES,
  type ActivityTab,
  type ActivityVerb,
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
import { ActivityFeed } from "./_components/activity-feed";
import { ActivityFilters } from "./_components/activity-filters";
import { ActivitySkeleton } from "./_components/activity-skeleton";

export const dynamic = "force-dynamic";

interface ActivityPageProps {
  // Next.js 15+: searchParams is a Promise (per Setup notes T002 in
  // progress.md). Don't access it synchronously.
  searchParams: Promise<{
    tab?: string;
    cursor?: string;
    chips?: string;
    since?: string;
  }>;
}

export default async function ActivityPage({ searchParams }: ActivityPageProps) {
  // auth() and searchParams are independent — start both immediately so
  // the route doesn't waterfall (vercel-react-best-practices: async-parallel).
  const [session, sp] = await Promise.all([auth(), searchParams]);
  if (!session?.user?.id) {
    redirect("/login");
  }
  const userId = session.user.id;
  const tab = parseTab(sp.tab);
  // US6 — filter chips. Resolved server-side so SSR + the client polling
  // hook send the same shape; chip ids stay opaque to the URL.
  const chipIds = parseCsv(sp.chips);
  const verbs = resolveChipsToVerbs(chipIds);
  const since = resolveSince(sp.since ?? null);

  const workspace = await getCurrentWorkspace(userId);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-balance">
          Activity
        </h1>
        <p className="mt-1 text-balance text-muted-foreground">
          What you, your brands, and your workspace have been up to.
        </p>
      </header>

      <ActivityFilters />

      <Suspense
        // Re-mount the feed when the tab OR filter state changes so the
        // feed's internal pagination state resets cleanly. Cursor is
        // dropped on filter change at the URL layer (see ActivityFilters).
        key={`${tab}|${chipIds.join(",")}|${sp.since ?? "all"}`}
        fallback={
          <div className="space-y-4">
            <div className="h-8" /> {/* tab strip placeholder */}
            <div className="rounded-xl bg-card ring-1 ring-foreground/10">
              <ActivitySkeleton count={6} />
            </div>
          </div>
        }
      >
        <ActivityFeedLoader
          tab={tab}
          userId={userId}
          workspaceId={workspace?.id ?? null}
          verbs={verbs}
          since={since}
        />
      </Suspense>
    </div>
  );
}

/**
 * Server-side first-page loader. Lives inline because it's a one-shot
 * boundary; pulling it into its own file would just spread the page's
 * scoping rules across multiple files.
 *
 * Co-emit dedupe (QA flagged for Phase 4): the image / video gen flows emit
 * BOTH `generation.created` (object_type='asset') AND
 * `generation.completed` (object_type='generation', metadata.assetId set)
 * in the same handler. We suppress the `.completed` row in the UI when its
 * `metadata.assetId` matches an asset we've already shown via a sibling
 * `.created` event in the same page. Net effect: one row per generation
 * request, even though the ledger has two. Documented in progress.md.
 */
async function ActivityFeedLoader({
  tab,
  userId,
  workspaceId,
  verbs,
  since,
}: {
  tab: ActivityTab;
  userId: string;
  workspaceId: string | null;
  verbs: ActivityVerb[];
  since: Date | null;
}) {
  if (!workspaceId) {
    // Unbootstrapped user — match the API's empty shape.
    return (
      <ActivityFeed
        tab={tab}
        initialItems={[]}
        initialNextCursor={null}
      />
    );
  }

  const fetchLimit = ACTIVITY_LIMIT_DEFAULT + 1;
  let raw: RawActivityRow[];
  switch (tab) {
    case "for-you":
      raw = await loadForYouTab({
        userId,
        workspaceId,
        cursor: null,
        limit: fetchLimit,
        verbs,
        since,
      });
      break;
    case "my-brands":
      raw = await loadMyBrandsTab({
        userId,
        workspaceId,
        cursor: null,
        limit: fetchLimit,
        verbs,
        since,
      });
      break;
    case "workspace":
      raw = await loadWorkspaceTab({
        userId,
        workspaceId,
        cursor: null,
        limit: fetchLimit,
        verbs,
        since,
      });
      break;
  }

  const hasMore = raw.length > ACTIVITY_LIMIT_DEFAULT;
  const trimmed = hasMore ? raw.slice(0, ACTIVITY_LIMIT_DEFAULT) : raw;
  const nextCursor = hasMore
    ? encodeActivityCursor({
        createdAt: trimmed[trimmed.length - 1].createdAt.toISOString(),
        id: trimmed[trimmed.length - 1].id,
      })
    : null;

  const hydrated = await hydrateActivityEvents(trimmed, {
    getThumbnailUrl: (key) => getAssetUrl(key),
  });
  const items = dedupeCoEmittedCompleted(hydrated);

  return (
    <ActivityFeed
      tab={tab}
      initialItems={items}
      initialNextCursor={nextCursor}
    />
  );
}

function parseTab(value: string | undefined): ActivityTab {
  if (value && (ACTIVITY_TAB_VALUES as readonly string[]).includes(value)) {
    return value as ActivityTab;
  }
  return "for-you";
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
