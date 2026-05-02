/**
 * Workspace overview (T145a / OQ-006).
 *
 * Four widgets answer the "what should I do next?" question for an agency
 * teammate: their drafts, the queue they manage, what just shipped on their
 * brands, and their own throughput. Pure RSC — one DB roundtrip via
 * Promise.all, no client JS beyond Next's link router.
 */
import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileText,
  Film,
  Image as ImageIcon,
  Inbox,
  Sparkles,
  Video,
  Wand2,
} from "lucide-react";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets, brands } from "@/lib/db/schema";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import { isWorkspaceAdmin, loadRoleContext } from "@/lib/workspace/permissions";
import { getAssetUrl } from "@/lib/storage";
import { StatusBadge, type AssetStatus } from "@/components/status-badge";
import {
  RecentActivityRail,
  RecentActivityRailSkeleton,
} from "./_components/recent-activity-rail";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OverviewAsset {
  id: string;
  status: AssetStatus;
  prompt: string;
  thumbnailUrl: string;
  brandName: string | null;
  brandColor: string | null;
}

interface PersonalStats {
  weekCreated: number;
  weekApproved: number;
  weekPending: number;
  weekRejected: number;
  lifetimeCreated: number;
  lifetimeApproved: number;
  approvalRate: number; // 0..1, lifetime
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function OverviewPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const workspace = await getCurrentWorkspace(userId);
  if (!workspace) {
    return <NoWorkspaceState />;
  }

  const ctx = await loadRoleContext(userId, workspace.id);
  if (!ctx.workspace) {
    return <NoWorkspaceState />;
  }

  const isAdmin = isWorkspaceAdmin(ctx);
  const memberBrandIds = Array.from(ctx.brandMemberships.keys());
  const managerBrandIds = Array.from(ctx.brandMemberships.entries())
    .filter(([, role]) => role === "brand_manager")
    .map(([id]) => id);

  // Single roundtrip — four independent queries fan out via Promise.all.
  const [drafts, pending, approved, stats] = await Promise.all([
    fetchDrafts(userId, workspace.id),
    fetchPendingReview({
      workspaceId: workspace.id,
      isAdmin,
      managerBrandIds,
    }),
    fetchRecentlyApproved({
      userId,
      workspaceId: workspace.id,
      isAdmin,
      memberBrandIds,
    }),
    fetchPersonalStats(userId),
  ]);

  // Resolve thumbnail URLs server-side. getAssetUrl is async (signed-URL
  // backends) so we batch with Promise.all.
  const [draftThumbs, pendingThumbs, approvedThumbs] = await Promise.all([
    hydrateUrls(drafts),
    hydrateUrls(pending),
    hydrateUrls(approved),
  ]);

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
          {workspace.name}
        </p>
        <p className="text-sm text-muted-foreground">
          Pick up where you left off — drafts, the review queue, and what your
          brands have shipped this week.
        </p>
      </header>

      <ActionStrip />

      {/* Recent activity rail (US3). Sits between the quick-action strip
          and the widget grid: action first, then "what just happened,"
          then the deeper widgets. Wrapped in Suspense so first paint
          isn't blocked on the activity query. */}
      <Suspense fallback={<RecentActivityRailSkeleton />}>
        <RecentActivityRail userId={userId} workspaceId={workspace.id} />
      </Suspense>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-2">
        <Widget
          title="Your drafts"
          icon={FileText}
          href={`/gallery?status=draft&creator=${userId}`}
          ctaLabel="View all"
          empty={{
            icon: Sparkles,
            title: "No drafts yet",
            body: "Generate something on /generate and it'll land here.",
          }}
          assets={draftThumbs}
        />
        <Widget
          title="Pending review"
          icon={ClipboardList}
          href="/review"
          ctaLabel="Open queue"
          empty={
            managerBrandIds.length === 0 && !isAdmin
              ? {
                  icon: Inbox,
                  title: "Not a brand manager",
                  body: "Review-queue items appear here once you manage a brand.",
                }
              : {
                  icon: CheckCircle2,
                  title: "Inbox zero",
                  body: "Nothing waiting on your review right now.",
                }
          }
          assets={pendingThumbs}
        />
        <Widget
          title="Recently approved"
          icon={CheckCircle2}
          href="/gallery?status=approved"
          ctaLabel="See all"
          empty={{
            icon: CheckCircle2,
            title: "No approvals yet",
            body: "Approved assets across your brands will show up here.",
          }}
          assets={approvedThumbs}
        />
        <PersonalStatsCard stats={stats} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action strip — quick-launch tiles into /generate with prefilled context
// ---------------------------------------------------------------------------

interface ActionTile {
  title: string;
  hint: string;
  href: string;
  icon: typeof Wand2;
}

const ACTION_TILES: ActionTile[] = [
  {
    title: "Text → Image",
    hint: "Describe it, generate it.",
    href: "/generate",
    icon: Wand2,
  },
  {
    title: "Image → Image",
    hint: "Edit or restyle a reference.",
    href: "/generate?focus=imageInput&model=flux-kontext-pro",
    icon: ImageIcon,
  },
  {
    title: "Text → Video",
    hint: "Generate a clip from a prompt.",
    href: "/generate?mediaType=video",
    icon: Video,
  },
  {
    title: "Animate",
    hint: "Bring a still image to life.",
    href: "/generate?mediaType=video&focus=imageInput",
    icon: Film,
  },
];

function ActionStrip() {
  return (
    <section aria-label="Quick actions">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ACTION_TILES.map((tile) => (
          <Link
            key={tile.title}
            href={tile.href}
            className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 transition-colors hover:border-border hover:bg-secondary/30"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
              <tile.icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-heading text-sm font-semibold tracking-tight">
                {tile.title}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {tile.hint}
              </span>
            </span>
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </Link>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Widget shell
// ---------------------------------------------------------------------------

interface WidgetProps {
  title: string;
  icon: typeof FileText;
  href: string;
  ctaLabel: string;
  empty: { icon: typeof FileText; title: string; body: string };
  assets: OverviewAsset[];
}

function Widget({ title, icon: Icon, href, ctaLabel, empty, assets }: WidgetProps) {
  return (
    <section className="flex flex-col rounded-xl border border-border/60 bg-card p-5">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <h2 className="font-heading text-sm font-semibold tracking-tight">{title}</h2>
          <span className="text-xs text-muted-foreground tabular-nums">({assets.length})</span>
        </div>
        <Link
          href={href}
          className="group inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {ctaLabel}
          <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </header>
      <div className="mt-4 flex-1">
        {assets.length === 0 ? (
          <EmptyState {...empty} />
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {assets.map((a) => (
              <AssetThumb key={a.id} asset={a} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function AssetThumb({ asset }: { asset: OverviewAsset }) {
  return (
    <div
      className="group relative aspect-square overflow-hidden rounded-md bg-muted ring-1 ring-border/40"
      title={asset.prompt}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset.thumbnailUrl}
        alt={asset.prompt}
        loading="lazy"
        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
      />
      <div className="absolute right-1 top-1">
        <StatusBadge status={asset.status} />
      </div>
      {asset.brandName && asset.brandColor && (
        <div className="absolute bottom-1 left-1">
          <span
            className="rounded-full border px-1.5 py-0.5 text-[9px] font-semibold backdrop-blur-sm"
            style={{
              backgroundColor: `${asset.brandColor}40`,
              borderColor: `${asset.brandColor}60`,
              color: "white",
            }}
          >
            {asset.brandName}
          </span>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof FileText;
  title: string;
  body: string;
}) {
  return (
    <div className="flex h-full min-h-[180px] flex-col items-center justify-center rounded-md border border-dashed border-border/60 px-4 py-8 text-center">
      <Icon className="mb-2 size-6 text-muted-foreground/60" />
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-[28ch] text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Personal stats
// ---------------------------------------------------------------------------

function PersonalStatsCard({ stats }: { stats: PersonalStats }) {
  const pct = Math.round(stats.approvalRate * 100);
  return (
    <section className="flex flex-col rounded-xl border border-border/60 bg-card p-5">
      <header className="flex items-center gap-2">
        <Sparkles className="size-4 text-muted-foreground" />
        <h2 className="font-heading text-sm font-semibold tracking-tight">Your week</h2>
      </header>
      <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-4">
        <Stat label="Created" value={stats.weekCreated} />
        <Stat label="Approved" value={stats.weekApproved} />
        <Stat label="Pending" value={stats.weekPending} />
        <Stat label="Rejected" value={stats.weekRejected} />
        <div className="ml-auto inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 ring-1 ring-inset ring-emerald-500/30">
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
            Approval rate
          </span>
          <span className="text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
            {pct}%
          </span>
        </div>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Lifetime: {stats.lifetimeCreated} created · {stats.lifetimeApproved} approved
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-0.5">
      <div className="font-heading text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function NoWorkspaceState() {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
      <Inbox className="mb-3 size-10 text-muted-foreground/50" />
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        No studio yet
      </h1>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        You aren&apos;t a member of any studio yet. Ask an admin to invite
        you, or contact support to get started.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const ROW_COLUMNS = {
  id: assets.id,
  status: assets.status,
  prompt: assets.prompt,
  r2Key: assets.r2Key,
  thumbnailR2Key: assets.thumbnailR2Key,
  brandName: brands.name,
  brandColor: brands.color,
} as const;

async function fetchDrafts(userId: string, workspaceId: string) {
  return db
    .select(ROW_COLUMNS)
    .from(assets)
    .innerJoin(brands, eq(brands.id, assets.brandId))
    .where(
      and(
        eq(assets.userId, userId),
        eq(assets.status, "draft"),
        eq(brands.workspaceId, workspaceId)
      )
    )
    .orderBy(desc(assets.createdAt))
    .limit(6);
}

async function fetchPendingReview(opts: {
  workspaceId: string;
  isAdmin: boolean;
  managerBrandIds: string[];
}) {
  const { workspaceId, isAdmin, managerBrandIds } = opts;
  const conditions = [
    eq(assets.status, "in_review"),
    eq(brands.workspaceId, workspaceId),
    eq(brands.isPersonal, false),
  ];
  if (!isAdmin) {
    if (managerBrandIds.length === 0) return [];
    conditions.push(inArray(assets.brandId, managerBrandIds));
  }
  return db
    .select(ROW_COLUMNS)
    .from(assets)
    .innerJoin(brands, eq(brands.id, assets.brandId))
    .where(and(...conditions))
    .orderBy(desc(assets.createdAt))
    .limit(6);
}

async function fetchRecentlyApproved(opts: {
  userId: string;
  workspaceId: string;
  isAdmin: boolean;
  memberBrandIds: string[];
}) {
  const { userId, workspaceId, isAdmin, memberBrandIds } = opts;
  const conditions = [
    eq(assets.status, "approved"),
    eq(brands.workspaceId, workspaceId),
  ];
  if (!isAdmin) {
    if (memberBrandIds.length === 0) {
      conditions.push(eq(assets.userId, userId));
    } else {
      conditions.push(
        or(eq(assets.userId, userId), inArray(assets.brandId, memberBrandIds))!
      );
    }
  }
  return db
    .select(ROW_COLUMNS)
    .from(assets)
    .innerJoin(brands, eq(brands.id, assets.brandId))
    .where(and(...conditions))
    .orderBy(desc(assets.updatedAt))
    .limit(6);
}

async function fetchPersonalStats(userId: string): Promise<PersonalStats> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      weekCreated: sql<number>`count(*) filter (where ${assets.createdAt} >= ${weekAgo})::int`,
      weekApproved: sql<number>`count(*) filter (where ${assets.status} = 'approved' and ${assets.updatedAt} >= ${weekAgo})::int`,
      weekRejected: sql<number>`count(*) filter (where ${assets.status} = 'rejected' and ${assets.updatedAt} >= ${weekAgo})::int`,
      pending: sql<number>`count(*) filter (where ${assets.status} = 'in_review')::int`,
      lifetimeCreated: sql<number>`count(*)::int`,
      lifetimeApproved: sql<number>`count(*) filter (where ${assets.status} = 'approved')::int`,
    })
    .from(assets)
    .where(eq(assets.userId, userId));

  const r = rows[0] ?? {
    weekCreated: 0,
    weekApproved: 0,
    weekRejected: 0,
    pending: 0,
    lifetimeCreated: 0,
    lifetimeApproved: 0,
  };

  const lifetimeCreated = Number(r.lifetimeCreated);
  const lifetimeApproved = Number(r.lifetimeApproved);
  return {
    weekCreated: Number(r.weekCreated),
    weekApproved: Number(r.weekApproved),
    weekPending: Number(r.pending),
    weekRejected: Number(r.weekRejected),
    lifetimeCreated,
    lifetimeApproved,
    approvalRate: lifetimeCreated > 0 ? lifetimeApproved / lifetimeCreated : 0,
  };
}

// ---------------------------------------------------------------------------
// URL hydration
// ---------------------------------------------------------------------------

type AssetRow = {
  id: string;
  status: AssetStatus | null;
  prompt: string;
  r2Key: string;
  thumbnailR2Key: string | null;
  brandName: string | null;
  brandColor: string | null;
};

async function hydrateUrls(rows: AssetRow[]): Promise<OverviewAsset[]> {
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      status: (row.status ?? "draft") as AssetStatus,
      prompt: row.prompt,
      thumbnailUrl: await getAssetUrl(row.thumbnailR2Key ?? row.r2Key),
      brandName: row.brandName,
      brandColor: row.brandColor,
    }))
  );
}
