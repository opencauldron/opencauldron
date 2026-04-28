/**
 * Pure validation contract for the asset-upload route (US6 / T120).
 *
 * Lives in its own module so tests can import it without dragging in the
 * route's `next/server` + `next-auth` + DB module graph. The route itself
 * MUST keep using `validateAssetUpload` so the runtime path can't drift from
 * what the tests assert.
 */

// Asset path (US6) — gallery uploads. 50MB; images and short videos.
export const ASSET_MAX_SIZE = 50 * 1024 * 1024;

export const ASSET_IMAGE_TYPES: string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

export const ASSET_VIDEO_TYPES: string[] = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
];

export type AssetUploadValidation =
  | { ok: true; mediaType: "image" | "video" }
  | {
      ok: false;
      status: number;
      error: string;
      allowed?: string[];
      maxBytes?: number;
    };

/**
 * Pure validator for the asset-upload path. Order matters — the MIME gate
 * runs before the size gate so a huge unsupported file returns 400, not 413.
 */
export function validateAssetUpload(file: {
  type: string;
  size: number;
}): AssetUploadValidation {
  const isImage = ASSET_IMAGE_TYPES.includes(file.type);
  const isVideo = ASSET_VIDEO_TYPES.includes(file.type);
  if (!isImage && !isVideo) {
    return {
      ok: false,
      status: 400,
      error: "unsupported_type",
      allowed: [...ASSET_IMAGE_TYPES, ...ASSET_VIDEO_TYPES],
    };
  }
  if (file.size > ASSET_MAX_SIZE) {
    return {
      ok: false,
      status: 413,
      error: "file_too_large",
      maxBytes: ASSET_MAX_SIZE,
    };
  }
  return { ok: true, mediaType: isImage ? "image" : "video" };
}
