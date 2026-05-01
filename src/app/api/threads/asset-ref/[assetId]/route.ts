/**
 * GET /api/threads/asset-ref/[assetId] — resolve an `asset_ref` attachment for
 * a thread viewer (Phase 5 / T047 defense-in-depth).
 *
 * The legacy `/api/library/[id]` endpoint scopes by `assets.user_id = current
 * user`, which would 404 a workspace teammate's asset reference even when
 * the viewer legitimately belongs to the asset's workspace. Threads need a
 * different resolution: any workspace member can READ their teammates'
 * assets when those assets are referenced inside a thread message.
 *
 * Auth: signed-in workspace member of the asset's workspace.
 * Flag : 404 when `THREADS_ENABLED=false`.
 *
 * Response shape (200): `{ asset: { id, url, thumbnailUrl, fileName, source,
 * width, height, mimeType, brandId } }`. Slim — the picker hydrates more,
 * but inside the thread surface we only need a thumbnail + filename + source.
 *
 * Cross-workspace / deleted asset → 403 / 404 respectively. The client
 * renders the "Restricted asset" placeholder uniformly for both per spec
 * FR-005 (we don't leak existence to non-members).
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { assets, uploads } from "@/lib/db/schema";
import { getAssetUrl } from "@/lib/storage";
import {
  PermissionError,
  assertWorkspaceMemberForAsset,
} from "@/lib/threads/permissions";

function flagOff(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  if (!env.THREADS_ENABLED) return flagOff();

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { assetId } = await params;

  // Workspace membership of the asset's workspace. Throws 403 if the viewer
  // isn't in the workspace; 404 if the asset doesn't exist.
  try {
    await assertWorkspaceMemberForAsset(userId, assetId);
  } catch (err) {
    if (err instanceof PermissionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const [row] = await db
    .select({
      id: assets.id,
      brandId: assets.brandId,
      r2Key: assets.r2Key,
      thumbnailR2Key: assets.thumbnailR2Key,
      fileName: assets.fileName,
      width: assets.width,
      height: assets.height,
      source: assets.source,
      mediaType: assets.mediaType,
      mimeType: uploads.contentType,
    })
    .from(assets)
    .leftJoin(uploads, eq(uploads.assetId, assets.id))
    .where(eq(assets.id, assetId))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "asset_not_found" }, { status: 404 });
  }

  const [url, thumbnailUrl] = await Promise.all([
    getAssetUrl(row.r2Key),
    row.thumbnailR2Key ? getAssetUrl(row.thumbnailR2Key) : Promise.resolve(""),
  ]);

  return NextResponse.json({
    asset: {
      id: row.id,
      brandId: row.brandId,
      url,
      thumbnailUrl: thumbnailUrl || url,
      fileName: row.fileName,
      width: row.width,
      height: row.height,
      source: row.source,
      mediaType: row.mediaType,
      mimeType: row.mimeType,
    },
  });
}
