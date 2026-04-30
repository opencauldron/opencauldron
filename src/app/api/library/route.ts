/**
 * GET /api/library — unified Library list endpoint (US1 / T011, US2 / T025).
 *
 * Returns the current user's assets across every `source` value (uploaded,
 * generated, imported), ordered by `(createdAt desc, id desc)` and paginated
 * with a composite cursor so ties on `createdAt` (sub-millisecond inserts)
 * never duplicate or skip rows.
 *
 * Phase 4 (US2) extension — query parameters:
 *   - `q`         — full-text search; ranked by `ts_rank(search_vector, query)`.
 *                    Cursor pagination is replaced with offset (hard limit 200)
 *                    when `q` is set since rank order isn't time-monotonic.
 *   - `brand`     — single brand uuid.
 *   - `campaign`  — single campaign uuid.
 *   - `tag`       — repeatable; multi-tag.
 *   - `tagOp`     — `or` (default) or `and`. AND uses HAVING count(distinct).
 *   - `source`    — repeatable; one of uploaded/generated/imported.
 *   - `status`    — repeatable; one of draft/in_review/approved/rejected/archived.
 *   - `cursor`    — composite `<isoTs>__<uuid>` cursor (only used when no `q`).
 *   - `limit`     — clamps 1..200, default 50.
 *   - `mode`      — RESERVED for Phase 5 (semantic/hybrid). Ignored today.
 *
 * Response shape:
 *   {
 *     items:      LibraryItem[],
 *     nextCursor: string | null,   // null when q is set or no more pages
 *     total:      number,          // count of all rows matching the filter,
 *                                  //   ignoring pagination
 *   }
 *
 * Behind the `LIBRARY_DAM_ENABLED` flag — returns 404 when off so the new
 * surface lands dark per the spec's "compat-shim window" approach.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import { loadRoleContext, isWorkspaceAdmin } from "@/lib/workspace/permissions";
import {
  type LibraryItem,
  hydrateLibraryItem,
  loadTagsAndCampaigns,
  type AssetJoinRow,
} from "./lib";

export type { LibraryItem };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const FTS_HARD_LIMIT = 200;

const VALID_SOURCES = new Set<"uploaded" | "generated" | "imported">([
  "uploaded",
  "generated",
  "imported",
]);
const VALID_STATUSES = new Set<
  "draft" | "in_review" | "approved" | "rejected" | "archived"
>(["draft", "in_review", "approved", "rejected", "archived"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Composite cursor: `<isoCreatedAt>__<uuid>`. Lexicographic on (createdAt, id)
// matching the index `assets_user_id_created_at_idx` plus the id tiebreaker.
function encodeCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}__${id}`;
}

function decodeCursor(raw: string | null): { createdAt: Date; id: string } | null {
  if (!raw) return null;
  const sep = raw.lastIndexOf("__");
  if (sep < 0) return null;
  const ts = raw.slice(0, sep);
  const id = raw.slice(sep + 2);
  const date = new Date(ts);
  if (Number.isNaN(date.getTime()) || !id) return null;
  return { createdAt: date, id };
}

function parseListFilter<T>(
  values: string[],
  whitelist: Set<T>
): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const v of values) {
    if (whitelist.has(v as T) && !seen.has(v as T)) {
      seen.add(v as T);
      out.push(v as T);
    }
  }
  return out;
}

type ListRow = {
  id: string;
  user_id: string;
  brand_id: string | null;
  r2_key: string;
  thumbnail_r2_key: string | null;
  file_name: string | null;
  file_size: number | null;
  width: number | null;
  height: number | null;
  usage_count: number;
  source: "uploaded" | "generated" | "imported";
  status: "draft" | "in_review" | "approved" | "rejected" | "archived";
  embedded_at: Date | string | null;
  created_at: Date | string;
  media_type: "image" | "video";
  upload_content_type: string | null;
  creator_id: string | null;
  creator_name: string | null;
  creator_image: string | null;
  creator_email: string | null;
};

type ListRowWithCount = ListRow & { total_count: number; [k: string]: unknown };

function stripTotal(r: ListRowWithCount): ListRow {
  // Drop the window-function-supplied total_count column from each row so the
  // hydrator only sees the asset shape it expects.
  const {
    total_count: _t, // eslint-disable-line @typescript-eslint/no-unused-vars
    ...rest
  } = r;
  return rest as ListRow;
}

function rowToJoin(r: ListRow): AssetJoinRow {
  return {
    id: r.id,
    userId: r.user_id,
    brandId: r.brand_id,
    r2Key: r.r2_key,
    thumbnailR2Key: r.thumbnail_r2_key,
    fileName: r.file_name,
    fileSize: r.file_size,
    width: r.width,
    height: r.height,
    usageCount: r.usage_count,
    source: r.source,
    status: r.status,
    embeddedAt:
      r.embedded_at == null
        ? null
        : r.embedded_at instanceof Date
        ? r.embedded_at
        : new Date(r.embedded_at),
    createdAt:
      r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    mediaType: r.media_type,
    uploadContentType: r.upload_content_type,
    creatorId: r.creator_id,
    creatorName: r.creator_name,
    creatorImage: r.creator_image,
    creatorEmail: r.creator_email,
  };
}

export async function GET(req: NextRequest) {
  if (!env.LIBRARY_DAM_ENABLED) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const cursor = decodeCursor(searchParams.get("cursor"));
  const limitParam = parseInt(searchParams.get("limit") ?? `${DEFAULT_LIMIT}`, 10);
  const limit = Math.min(
    Math.max(Number.isFinite(limitParam) ? limitParam : DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );

  const brandId = searchParams.get("brand");
  const campaignId = searchParams.get("campaign");
  const tagOp = searchParams.get("tagOp") === "and" ? "and" : "or";
  const tags = searchParams
    .getAll("tag")
    .filter((t) => t.length > 0 && t.length <= 100);
  const sources = parseListFilter(
    searchParams.getAll("source"),
    VALID_SOURCES as Set<string>
  ) as ("uploaded" | "generated" | "imported")[];
  const statuses = parseListFilter(
    searchParams.getAll("status"),
    VALID_STATUSES as Set<string>
  ) as ("draft" | "in_review" | "approved" | "rejected" | "archived")[];
  const qRaw = searchParams.get("q");
  const q = qRaw && qRaw.trim().length > 0 ? qRaw.trim() : null;

  // Defensive uuid validation — never let an unsanitized string near jsonb/uuid
  // operators. Invalid → ignored, equivalent to "no filter".
  const safeBrandId = brandId && UUID_RE.test(brandId) ? brandId : null;
  const safeCampaignId =
    campaignId && UUID_RE.test(campaignId) ? campaignId : null;

  // Workspace + admin check. Admins see every asset in the workspace
  // (matching the page's initial-render scope); members are bound to their
  // own assets.
  const workspace = await getCurrentWorkspace(userId);
  const isAdmin = workspace
    ? isWorkspaceAdmin(await loadRoleContext(userId, workspace.id))
    : false;

  // Build the WHERE clause as a list of sql fragments. Final SQL is composed
  // by `sql.join(... AND ...)` — drizzle parameterizes each value, so even
  // values pulled directly from URL inputs are safe against injection.
  const where: ReturnType<typeof sql>[] = [];
  if (isAdmin && workspace) {
    where.push(
      sql`a.brand_id IN (SELECT id FROM brands WHERE workspace_id = ${workspace.id})`
    );
  } else {
    where.push(sql`a.user_id = ${userId}`);
  }

  if (safeBrandId) {
    where.push(sql`a.brand_id = ${safeBrandId}`);
  }
  if (safeCampaignId) {
    where.push(
      sql`a.id IN (SELECT asset_id FROM asset_campaigns WHERE campaign_id = ${safeCampaignId})`
    );
  }
  if (sources.length > 0) {
    where.push(
      sql`a.source IN (${sql.join(
        sources.map((s) => sql`${s}`),
        sql`, `
      )})`
    );
  }
  if (statuses.length > 0) {
    where.push(
      sql`a.status IN (${sql.join(
        statuses.map((s) => sql`${s}`),
        sql`, `
      )})`
    );
  }
  if (tags.length > 0) {
    if (tagOp === "and") {
      // ALL of these tags — group by + having count.
      where.push(
        sql`a.id IN (
          SELECT asset_id
          FROM asset_tags
          WHERE tag IN (${sql.join(
            tags.map((t) => sql`${t}`),
            sql`, `
          )})
          GROUP BY asset_id
          HAVING COUNT(DISTINCT tag) = ${tags.length}
        )`
      );
    } else {
      where.push(
        sql`a.id IN (
          SELECT asset_id
          FROM asset_tags
          WHERE tag IN (${sql.join(
            tags.map((t) => sql`${t}`),
            sql`, `
          )})
        )`
      );
    }
  }

  const whereClause = sql.join(where, sql` AND `);

  // -------------------------------------------------------------------------
  // Total count — single window-function pass on the filtered set. Cheaper
  // than a parallel COUNT(*) for the common case (user has < 1k rows). We
  // alias as `total_count` and return it on the first item; if there are
  // zero rows we run a cheap fallback COUNT.
  // -------------------------------------------------------------------------

  let nextCursor: string | null = null;
  let rows: ListRow[] = [];
  let total = 0;

  if (q) {
    // Full-text path. Order by ts_rank desc, fall back to created_at desc on
    // ties. Offset paginates within the hard limit since rank order isn't
    // time-monotonic. Frontend currently only requests page 1; future infinite
    // scroll on FTS results would pass `cursor` as a numeric offset (kept
    // simple here — FTS pagination beyond 200 hits is a Phase 5 problem).
    const offset =
      cursor && Number.isFinite(parseInt(cursor.id, 10))
        ? Math.max(0, parseInt(cursor.id, 10))
        : 0;
    const effLimit = Math.min(limit, FTS_HARD_LIMIT);

    const result = await db.execute<ListRowWithCount>(sql`
      SELECT
        a.id, a.user_id, a.brand_id, a.r2_key, a.thumbnail_r2_key,
        a.file_name, a.file_size, a.width, a.height, a.usage_count,
        a.source, a.status, a.embedded_at, a.created_at, a.media_type,
        u.content_type AS upload_content_type,
        cu.id AS creator_id,
        cu.name AS creator_name,
        cu.image AS creator_image,
        cu.email AS creator_email,
        COUNT(*) OVER() AS total_count
      FROM assets a
      LEFT JOIN uploads u ON u.asset_id = a.id
      LEFT JOIN users cu ON cu.id = a.user_id
      WHERE ${whereClause}
        AND a.search_vector @@ websearch_to_tsquery('english', ${q})
      ORDER BY ts_rank(a.search_vector, websearch_to_tsquery('english', ${q})) DESC,
               a.created_at DESC, a.id DESC
      LIMIT ${effLimit}
      OFFSET ${offset}
    `);

    const allRows = result.rows as Array<ListRow & { total_count: number }>;
    rows = allRows.map((r) => stripTotal(r));
    total = allRows.length > 0 ? Number(allRows[0].total_count) : 0;
    // No more pages if we ran past hard limit — keep `nextCursor` null.
    nextCursor = null;
  } else {
    // Cursor path. (createdAt, id) lexicographic descending.
    const cursorClause = cursor
      ? sql`AND (a.created_at < ${cursor.createdAt.toISOString()}::timestamptz
              OR (a.created_at = ${cursor.createdAt.toISOString()}::timestamptz AND a.id < ${cursor.id}))`
      : sql``;

    const result = await db.execute<ListRowWithCount>(sql`
      SELECT
        a.id, a.user_id, a.brand_id, a.r2_key, a.thumbnail_r2_key,
        a.file_name, a.file_size, a.width, a.height, a.usage_count,
        a.source, a.status, a.embedded_at, a.created_at, a.media_type,
        u.content_type AS upload_content_type,
        cu.id AS creator_id,
        cu.name AS creator_name,
        cu.image AS creator_image,
        cu.email AS creator_email,
        COUNT(*) OVER() AS total_count
      FROM assets a
      LEFT JOIN uploads u ON u.asset_id = a.id
      LEFT JOIN users cu ON cu.id = a.user_id
      WHERE ${whereClause}
      ${cursorClause}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${limit + 1}
    `);

    const allRows = result.rows as Array<ListRow & { total_count: number }>;
    total = allRows.length > 0 ? Number(allRows[0].total_count) : 0;
    const hasMore = allRows.length > limit;
    const trimmed = hasMore ? allRows.slice(0, limit) : allRows;
    rows = trimmed.map((r) => stripTotal(r));

    if (hasMore && trimmed.length > 0) {
      const last = trimmed[trimmed.length - 1];
      nextCursor = encodeCursor(
        last.created_at instanceof Date
          ? last.created_at
          : new Date(last.created_at),
        last.id
      );
    }
  }

  // If the WHERE matched nothing, the window function emits zero rows — but
  // we still want `total = 0` (already correct above).

  const joinRows = rows.map(rowToJoin);
  const { tags: tagMap, campaigns: campaignMap } = await loadTagsAndCampaigns(
    joinRows.map((r) => r.id)
  );

  const items: LibraryItem[] = await Promise.all(
    joinRows.map((r) =>
      hydrateLibraryItem(r, tagMap.get(r.id) ?? [], campaignMap.get(r.id) ?? [])
    )
  );

  return NextResponse.json({ items, nextCursor, total });
}
