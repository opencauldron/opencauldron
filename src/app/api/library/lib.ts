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
} from "@/lib/db/schema";
import { getAssetUrl } from "@/lib/storage";

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
  tags: string[];
  campaigns: string[];
  embeddedAt: string | null;
  createdAt: string;
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
  embeddedAt: Date | null;
  createdAt: Date;
  mediaType: "image" | "video";
  uploadContentType: string | null;
}

/**
 * Fan out the per-asset tag and campaign lookups in a single round-trip per
 * relation, then key them by assetId for O(1) merges.
 */
export async function loadTagsAndCampaigns(
  assetIds: string[]
): Promise<{ tags: Map<string, string[]>; campaigns: Map<string, string[]> }> {
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

  const campaigns = new Map<string, string[]>();
  for (const r of campaignRows) {
    const list = campaigns.get(r.assetId) ?? [];
    list.push(r.campaignName);
    campaigns.set(r.assetId, list);
  }

  return { tags, campaigns };
}

/** Convert a DB row + tag/campaign maps into the public Library item shape. */
export async function hydrateLibraryItem(
  row: AssetJoinRow,
  tags: string[],
  campaigns: string[]
): Promise<LibraryItem> {
  const url = await getAssetUrl(row.r2Key);
  const thumbnailUrl = row.thumbnailR2Key
    ? await getAssetUrl(row.thumbnailR2Key)
    : null;

  // Legacy references always carried `mimeType`. For migrated and newly-
  // uploaded assets the paired `uploads.contentType` carries it; for
  // generations we don't track upstream MIME — fall back to a sensible value
  // derived from `mediaType` so the picker keeps rendering.
  const mimeType =
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
    tags,
    campaigns,
    embeddedAt: row.embeddedAt ? row.embeddedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
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
      embeddedAt: assets.embeddedAt,
      createdAt: assets.createdAt,
      mediaType: assets.mediaType,
      uploadContentType: uploads.contentType,
    })
    .from(assets)
    .leftJoin(uploads, eq(uploads.assetId, assets.id))
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
