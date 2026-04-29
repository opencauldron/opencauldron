/**
 * GET /api/library — unified Library list endpoint (US1 / T011).
 *
 * Returns the current user's assets across every `source` value (uploaded,
 * generated, imported), ordered by `(createdAt desc, id desc)` and paginated
 * with a composite cursor so ties on `createdAt` (sub-millisecond inserts)
 * never duplicate or skip rows.
 *
 * The item shape is a deliberate SUPERSET of the legacy `/api/references` GET
 * item: every field the references-client and generate-client image-input
 * picker consume (`url`, `thumbnailUrl`, `fileName`, `fileSize`, `width`,
 * `height`, `mimeType`, `usageCount`, `createdAt`) is preserved 1:1, and the
 * library-only fields (`source`, `tags`, `campaigns`, `embeddedAt`, `brandId`)
 * are appended. The `/api/references` compat shim (T021) rewraps `items` →
 * `references` so the shape match is total.
 *
 * Behind the `LIBRARY_DAM_ENABLED` flag — returns 404 when off so the new
 * surface lands dark per the spec's "compat-shim window" approach.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets, uploads } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { and, desc, eq, lt, or } from "drizzle-orm";
import {
  type LibraryItem,
  hydrateLibraryItem,
  loadTagsAndCampaigns,
} from "./lib";

export type { LibraryItem };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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

export async function GET(req: NextRequest) {
  if (!env.LIBRARY_DAM_ENABLED) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const cursor = decodeCursor(searchParams.get("cursor"));
  const limitParam = parseInt(searchParams.get("limit") ?? `${DEFAULT_LIMIT}`, 10);
  const limit = Math.min(
    Math.max(Number.isFinite(limitParam) ? limitParam : DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );
  const brandIdFilter = searchParams.get("brandId");
  const sourceFilter = searchParams.get("source");

  const conditions = [eq(assets.userId, session.user.id)];

  if (cursor) {
    // (createdAt, id) lexicographic: rows where createdAt < cursor.createdAt,
    // OR createdAt == cursor.createdAt AND id < cursor.id.
    conditions.push(
      or(
        lt(assets.createdAt, cursor.createdAt),
        and(eq(assets.createdAt, cursor.createdAt), lt(assets.id, cursor.id))
      )!
    );
  }

  if (brandIdFilter) {
    conditions.push(eq(assets.brandId, brandIdFilter));
  }

  if (
    sourceFilter === "uploaded" ||
    sourceFilter === "generated" ||
    sourceFilter === "imported"
  ) {
    conditions.push(eq(assets.source, sourceFilter));
  }

  const rows = await db
    .select({
      id: assets.id,
      userId: assets.userId,
      brandId: assets.brandId,
      r2Key: assets.r2Key,
      thumbnailR2Key: assets.thumbnailR2Key,
      fileName: assets.fileName,
      fileSize: assets.fileSize,
      width: assets.width,
      height: assets.height,
      usageCount: assets.usageCount,
      source: assets.source,
      embeddedAt: assets.embeddedAt,
      createdAt: assets.createdAt,
      mediaType: assets.mediaType,
      uploadContentType: uploads.contentType,
    })
    .from(assets)
    .leftJoin(uploads, eq(uploads.assetId, assets.id))
    .where(and(...conditions))
    .orderBy(desc(assets.createdAt), desc(assets.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;

  const { tags, campaigns } = await loadTagsAndCampaigns(
    trimmed.map((r) => r.id)
  );

  const items: LibraryItem[] = await Promise.all(
    trimmed.map((r) =>
      hydrateLibraryItem(r, tags.get(r.id) ?? [], campaigns.get(r.id) ?? [])
    )
  );

  const last = trimmed[trimmed.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

  return NextResponse.json({ items, nextCursor });
}
