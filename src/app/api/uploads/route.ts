import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  uploadFile,
  generateAndUploadThumbnail,
  getAssetUrl,
  encodeDisplayWebp,
  displayWebpKey,
} from "@/lib/storage";
import { db } from "@/lib/db";
import { assets, brands, uploads } from "@/lib/db/schema";
import { emitActivity } from "@/lib/activity";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import {
  canCreateAsset,
  loadBrandContext,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { resolvePersonalBrandId } from "@/lib/workspace/personal";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { eq } from "drizzle-orm";

// Asset-upload validation contract lives in a sibling pure module so it can
// be unit-tested without dragging in this route's `next/server` + DB graph.
// Re-exported here for backward compatibility with any caller that imported
// from the route directly.
import {
  ASSET_MAX_SIZE,
  ASSET_IMAGE_TYPES,
  ASSET_VIDEO_TYPES,
  validateAssetUpload,
} from "./validation";
export {
  ASSET_MAX_SIZE,
  ASSET_IMAGE_TYPES,
  ASSET_VIDEO_TYPES,
  validateAssetUpload,
};
export type { AssetUploadValidation } from "./validation";

const EXT_MAP: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/**
 * POST /api/uploads — single unified upload path post-Library/DAM cutover
 * (T015 / FR-008). Every successful upload writes to `assets` with
 * `source = 'uploaded'`, regardless of whether `brandId` was provided.
 *
 * - `brandId` (optional): named brand or the literal `"personal"` sentinel.
 *   Absent → folded into the user's Personal brand (mirrors the Phase 2
 *   backfill script: `brands.is_personal = true AND brands.owner_id = userId`).
 * - Permissions: `canCreateAsset` gate on the resolved brand. Workspace admin
 *   override applies; viewers are denied.
 * - Response: a single shape that satisfies both consumers — the asset-
 *   centric `upload-dropzone.tsx` (reads `data.asset`) AND the legacy
 *   `generate-client.tsx` image-input flow (reads `data.url`). The latter
 *   was previously served by the dropped `references` branch.
 */

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const brandIdHint = (formData.get("brandId") as string | null) ?? null;

  if (!file) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }

  const validation = validateAssetUpload(file);
  if (!validation.ok) {
    const body: Record<string, unknown> = { error: validation.error };
    if (validation.allowed) body.allowed = validation.allowed;
    if (validation.maxBytes !== undefined) body.maxBytes = validation.maxBytes;
    return NextResponse.json(body, { status: validation.status });
  }
  const isImage = validation.mediaType === "image";

  const workspace = await getCurrentWorkspace(userId);
  if (!workspace) {
    return NextResponse.json({ error: "no_workspace" }, { status: 403 });
  }

  // Brand resolution. Three cases:
  //   1. `personal` sentinel              → user's Personal brand in this workspace.
  //   2. explicit brandId (uuid)          → must belong to this workspace.
  //   3. absent                           → fold into the user's Personal brand
  //                                        (mirrors the Phase 2 backfill).
  let brandId: string;
  if (brandIdHint === "personal" || brandIdHint === null) {
    const personalId = await resolvePersonalBrandId(userId, workspace.id);
    if (!personalId) {
      return NextResponse.json(
        { error: "personal_brand_missing" },
        { status: 404 }
      );
    }
    brandId = personalId;
  } else {
    const [b] = await db
      .select({ id: brands.id, workspaceId: brands.workspaceId })
      .from(brands)
      .where(eq(brands.id, brandIdHint))
      .limit(1);
    if (!b || b.workspaceId !== workspace.id) {
      return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
    }
    brandId = b.id;
  }

  const brandCtx = await loadBrandContext(brandId);
  if (!brandCtx) {
    return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
  }
  const ctx = await loadRoleContext(userId, workspace.id);

  // Personal-brand carve-out — the owner is implicitly a creator on their own
  // Personal brand even without an explicit `brand_members` row.
  if (brandCtx.isPersonal && brandCtx.ownerId === userId) {
    if (!ctx.brandMemberships.has(brandId)) {
      ctx.brandMemberships.set(brandId, "creator");
    }
  }

  if (!canCreateAsset(ctx, brandCtx)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = EXT_MAP[file.type] ?? "bin";
  const key = `assets/${userId}/${Date.now()}-${nanoid(10)}.${ext}`;
  const contentType = file.type;
  const url = await uploadFile(buffer, key, contentType);

  let width: number | null = null;
  let height: number | null = null;
  let thumbnailKey: string | null = null;

  // WebP display variant fields (FR-001..FR-005, FR-013). Populated only for
  // image uploads; videos leave webpStatus null per the locked decision.
  let webpR2Key: string | null = null;
  let webpFileSize: number | null = null;
  let webpStatus: "ready" | "failed" | null = null;
  let webpFailedReason: string | null = null;

  if (isImage) {
    try {
      const metadata = await sharp(buffer).metadata();
      width = metadata.width ?? null;
      height = metadata.height ?? null;
    } catch {
      // proceed without dimensions
    }
    try {
      thumbnailKey = await generateAndUploadThumbnail(buffer, key);
    } catch {
      // non-critical
    }

    // Encode the full-resolution WebP variant. Errors are caught inside the
    // helper and surfaced via the discriminated return — this never throws.
    // On success we PUT to `{originalKey}_display.webp`; on failure we still
    // persist the asset row so the original remains accessible (FR-013).
    const encoded = await encodeDisplayWebp(buffer, contentType);
    if (encoded.ok) {
      const webpKey = displayWebpKey(key);
      try {
        await uploadFile(encoded.buffer, webpKey, "image/webp");
        webpR2Key = webpKey;
        webpFileSize = encoded.size;
        webpStatus = "ready";
      } catch (err) {
        webpStatus = "failed";
        webpFailedReason =
          err instanceof Error ? `r2_put: ${err.message}` : "r2_put: unknown";
        console.error(
          "[uploads] WebP variant R2 PUT failed (asset still saved):",
          { key, reason: webpFailedReason }
        );
      }
    } else {
      webpStatus = "failed";
      webpFailedReason = encoded.reason;
      console.error(
        "[uploads] WebP encoder failed (asset still saved):",
        { key, reason: encoded.reason }
      );
    }
  }

  // Two-row write — assets first (FK target), then uploads. The Neon HTTP
  // driver doesn't expose db.transaction, so on the rare case the uploads
  // insert fails we hard-delete the assets row to keep the tables in sync.
  const [asset] = await db
    .insert(assets)
    .values({
      userId,
      brandId,
      status: "draft",
      source: "uploaded",
      brandKitOverridden: false,
      mediaType: isImage ? "image" : "video",
      model: "upload",
      provider: "upload",
      prompt: file.name,
      enhancedPrompt: null,
      parameters: { originalFilename: file.name, contentType },
      r2Key: key,
      r2Url: url,
      thumbnailR2Key: thumbnailKey,
      // WebP display variant (PR `feat/webp-image-delivery-backend`).
      // All four fields stay null on video uploads; on image uploads the
      // status is either 'ready' (key + size set) or 'failed' (reason set).
      webpR2Key,
      webpFileSize,
      webpStatus,
      webpFailedReason,
      // Original mime-type lifted onto the row so PR 2's dual-format download
      // can label "Original (PNG) · 14 MB" without joining `uploads`.
      originalMimeType: contentType,
      // FR-004: uploads now retain their original filename in the new column.
      fileName: file.name,
      usageCount: 0,
      width,
      height,
      fileSize: file.size,
      costEstimate: 0,
    })
    .returning({ id: assets.id, createdAt: assets.createdAt });

  try {
    await db.insert(uploads).values({
      assetId: asset.id,
      uploaderId: userId,
      originalFilename: file.name,
      contentType,
    });
  } catch (err) {
    await db.delete(assets).where(eq(assets.id, asset.id));
    throw err;
  }

  // Activity feed emission (US2 / FR-002). Visibility is computed at the call
  // site: private for Personal-brand drafts, brand otherwise. Sits next to
  // the source-of-truth INSERT — the global `db` handle is HTTP and doesn't
  // expose `transaction()`, matching the same constraint that the
  // notifications fan-out runs under at every transition site.
  await emitActivity(db, {
    actorId: userId,
    verb: "generation.created",
    objectType: "asset",
    objectId: asset.id,
    workspaceId: workspace.id,
    brandId,
    visibility: brandCtx.isPersonal ? "private" : "brand",
    metadata: {
      source: "uploaded",
      mediaType: isImage ? "image" : "video",
      fileName: file.name,
    },
  });

  const finalUrl = await getAssetUrl(key);
  const finalThumbnailUrl = thumbnailKey ? await getAssetUrl(thumbnailKey) : null;

  // Single response shape that satisfies BOTH consumers:
  //   - upload-dropzone.tsx          reads `data.asset`
  //   - generate-client.tsx          reads `data.url` (legacy references shape)
  // Future cleanup (Phase 6): once generate-client switches to `data.asset.url`
  // we can drop the top-level `url`/`key` fields.
  return NextResponse.json({
    url: finalUrl,
    key,
    asset: {
      id: asset.id,
      brandId,
      status: "draft" as const,
      mediaType: isImage ? ("image" as const) : ("video" as const),
      url: finalUrl,
      thumbnailUrl: finalThumbnailUrl ?? finalUrl,
      width,
      height,
      fileSize: file.size,
      createdAt: asset.createdAt,
    },
  });
}
