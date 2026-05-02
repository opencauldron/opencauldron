/**
 * Shared helpers for the Library API surface (T011/T012/T013).
 *
 * Hydrating an asset row into the public `LibraryItem` shape involves a
 * left-join on `uploads` (for `mimeType`), two follow-up SELECTs for
 * `assetTags` and `assetCampaigns`, and an R2-key → signed-URL resolve. Same
 * mechanics for the list and the detail routes; centralizing it here keeps
 * the contract identical and makes the `/api/references` compat shim
 * trivially correct (it just calls our handlers).
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  assets,
  assetCampaigns,
  assetTags,
  campaigns as campaignsTbl,
  uploads,
  users,
} from "@/lib/db/schema";
import { getAssetUrl } from "@/lib/storage";

export type AssetStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "rejected"
  | "archived";

export interface LibraryItem {
  id: string;
  userId: string;
  brandId: string | null;
  url: string;
  thumbnailUrl: string;
  fileName: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  usageCount: number;
  source: "uploaded" | "generated" | "imported";
  status: AssetStatus;
  creator: {
    id: string;
    name: string | null;
    image: string | null;
    email: string | null;
  } | null;
  tags: string[];
  /**
   * Brand campaigns this asset belongs to. Returned as `{id, name}` pairs so
   * the client can render names but PATCH back uuids (the API contract for
   * `campaigns` on `/api/library/[id]` PATCH is uuid-only).
   */
  campaigns: { id: string; name: string }[];
  embeddedAt: string | null;
  createdAt: string;
  // WebP display variant + dual-format download fields. Hydrated for every
  // item; null when the asset is a video, or pre-backfill, or its encoder
  // failed. Frontend uses webpStatus to gate the UX (silent fallback to
  // `url` when not 'ready').
  webpUrl: string | null;
  webpFileSize: number | null;
  webpStatus: "pending" | "ready" | "failed" | null;
  originalMimeType: string | null;
  // `fileSize` above is already the original; surfaced again here under an
  // explicit name so the dual-format download menu reads symmetrically with
  // `webpFileSize`. Same value, kept distinct for readability.
  originalFileSize: number | null;
}

export interface AssetJoinRow {
  id: string;
  userId: string;
  brandId: string | null;
  r2Key: string;
  thumbnailR2Key: string | null;
  fileName: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  usageCount: number;
  source: "uploaded" | "generated" | "imported";
  status: AssetStatus;
  embeddedAt: Date | null;
  createdAt: Date;
  mediaType: "image" | "video";
  uploadContentType: string | null;
  creatorId: string | null;
  creatorName: string | null;
  creatorImage: string | null;
  creatorEmail: string | null;
  webpR2Key: string | null;
  webpFileSize: number | null;
  webpStatus: "pending" | "ready" | "failed" | null;
  originalMimeType: string | null;
}

export type CampaignRef = { id: string; name: string };

/**
 * Fan out the per-asset tag and campaign lookups in a single round-trip per
 * relation, then key them by assetId for O(1) merges.
 *
 * Campaigns return as `{id, name}` pairs because the client needs both: the
 * name for chip labels and the uuid for the PATCH wire format.
 */
export async function loadTagsAndCampaigns(
  assetIds: string[]
): Promise<{
  tags: Map<string, string[]>;
  campaigns: Map<string, CampaignRef[]>;
}> {
  if (assetIds.length === 0) {
    return { tags: new Map(), campaigns: new Map() };
  }

  const [tagRows, campaignRows] = await Promise.all([
    db
      .select({ assetId: assetTags.assetId, tag: assetTags.tag })
      .from(assetTags)
      .where(inArray(assetTags.assetId, assetIds)),
    db
      .select({
        assetId: assetCampaigns.assetId,
        campaignId: campaignsTbl.id,
        campaignName: campaignsTbl.name,
      })
      .from(assetCampaigns)
      .innerJoin(campaignsTbl, eq(campaignsTbl.id, assetCampaigns.campaignId))
      .where(inArray(assetCampaigns.assetId, assetIds)),
  ]);

  const tags = new Map<string, string[]>();
  for (const r of tagRows) {
    const list = tags.get(r.assetId) ?? [];
    list.push(r.tag);
    tags.set(r.assetId, list);
  }

  const campaigns = new Map<string, CampaignRef[]>();
  for (const r of campaignRows) {
    const list = campaigns.get(r.assetId) ?? [];
    list.push({ id: r.campaignId, name: r.campaignName });
    campaigns.set(r.assetId, list);
  }

  return { tags, campaigns };
}

/** Convert a DB row + tag/campaign maps into the public Library item shape. */
export async function hydrateLibraryItem(
  row: AssetJoinRow,
  tags: string[],
  campaigns: CampaignRef[]
): Promise<LibraryItem> {
  // Resolve all storage URLs in parallel — saves a round-trip when both
  // thumbnail and webp keys are present.
  const [url, thumbnailUrl, webpUrl] = await Promise.all([
    getAssetUrl(row.r2Key),
    row.thumbnailR2Key ? getAssetUrl(row.thumbnailR2Key) : Promise.resolve(null),
    row.webpR2Key ? getAssetUrl(row.webpR2Key) : Promise.resolve(null),
  ]);

  // Legacy references always carried `mimeType`. For migrated and newly-
  // uploaded assets the paired `uploads.contentType` carries it; for
  // generations we don't track upstream MIME — fall back to a sensible value
  // derived from `mediaType` so the picker keeps rendering.
  // Prefer the new `original_mime_type` column when present (the upload +
  // generate routes populate it on every new write); fall back to the legacy
  // `uploads.contentType` join, then to a mediaType-derived default.
  const mimeType =
    row.originalMimeType ??
    row.uploadContentType ??
    (row.mediaType === "video" ? "video/mp4" : "image/png");

  return {
    id: row.id,
    userId: row.userId,
    brandId: row.brandId,
    url,
    thumbnailUrl: thumbnailUrl ?? url,
    fileName: row.fileName,
    fileSize: row.fileSize,
    width: row.width,
    height: row.height,
    mimeType,
    usageCount: row.usageCount,
    source: row.source,
    status: row.status,
    creator: row.creatorId
      ? {
          id: row.creatorId,
          name: row.creatorName,
          image: row.creatorImage,
          email: row.creatorEmail,
        }
      : null,
    tags,
    campaigns,
    embeddedAt: row.embeddedAt ? row.embeddedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    webpUrl,
    webpFileSize: row.webpFileSize,
    webpStatus: row.webpStatus,
    originalMimeType: mimeType,
    originalFileSize: row.fileSize,
  };
}

/**
 * Fetch a single asset scoped to `userId` and hydrate it. Returns `null` when
 * the row doesn't exist or doesn't belong to the user — the caller turns that
 * into the right HTTP status (404 for both — we don't leak existence).
 */
export async function loadOwnedLibraryItem(
  assetId: string,
  userId: string
): Promise<LibraryItem | null> {
  const [row] = await db
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
      status: assets.status,
      embeddedAt: assets.embeddedAt,
      createdAt: assets.createdAt,
      mediaType: assets.mediaType,
      uploadContentType: uploads.contentType,
      creatorId: users.id,
      creatorName: users.name,
      creatorImage: users.image,
      creatorEmail: users.email,
      webpR2Key: assets.webpR2Key,
      webpFileSize: assets.webpFileSize,
      webpStatus: assets.webpStatus,
      originalMimeType: assets.originalMimeType,
    })
    .from(assets)
    .leftJoin(uploads, eq(uploads.assetId, assets.id))
    .leftJoin(users, eq(users.id, assets.userId))
    .where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
    .limit(1);

  if (!row) return null;

  const { tags, campaigns } = await loadTagsAndCampaigns([row.id]);
  return hydrateLibraryItem(
    row,
    tags.get(row.id) ?? [],
    campaigns.get(row.id) ?? []
  );
}

/**
 * Variant for callers that have already authorized access (e.g. via
 * `assertWorkspaceMemberForAsset`). No ownership filter — the caller is
 * responsible for the auth gate. Used by PATCH so workspace teammates can
 * tag a peer's asset.
 */
export async function loadLibraryItemById(
  assetId: string
): Promise<LibraryItem | null> {
  const [row] = await db
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
      status: assets.status,
      embeddedAt: assets.embeddedAt,
      createdAt: assets.createdAt,
      mediaType: assets.mediaType,
      uploadContentType: uploads.contentType,
      creatorId: users.id,
      creatorName: users.name,
      creatorImage: users.image,
      creatorEmail: users.email,
      webpR2Key: assets.webpR2Key,
      webpFileSize: assets.webpFileSize,
      webpStatus: assets.webpStatus,
      originalMimeType: assets.originalMimeType,
    })
    .from(assets)
    .leftJoin(uploads, eq(uploads.assetId, assets.id))
    .leftJoin(users, eq(users.id, assets.userId))
    .where(eq(assets.id, assetId))
    .limit(1);

  if (!row) return null;

  const { tags, campaigns } = await loadTagsAndCampaigns([row.id]);
  return hydrateLibraryItem(
    row,
    tags.get(row.id) ?? [],
    campaigns.get(row.id) ?? []
  );
}
