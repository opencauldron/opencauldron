import sharp from "sharp";
import { nanoid } from "nanoid";
import { r2Backend } from "./r2";
import { localBackend } from "./local";
import type { StorageBackend } from "./types";

export type { StorageBackend };

function getBackend(): StorageBackend {
  return (process.env.STORAGE_PROVIDER ?? "r2") === "local"
    ? localBackend
    : r2Backend;
}

const THUMBNAIL_WIDTH = 400;

function generateKey(userId: string, ext: string = "png"): string {
  const timestamp = Date.now();
  const id = nanoid(10);
  return `assets/${userId}/${timestamp}-${id}.${ext}`;
}

/**
 * Upload a buffer to storage.
 */
export async function uploadFile(
  buffer: Buffer,
  key: string,
  contentType: string = "image/png"
): Promise<string> {
  return getBackend().upload(buffer, key, contentType);
}

/**
 * Get a URL for an asset.
 */
export async function getAssetUrl(key: string): Promise<string> {
  return getBackend().getUrl(key);
}

/**
 * Delete an asset from storage.
 */
export async function deleteFile(key: string): Promise<void> {
  return getBackend().delete(key);
}

/**
 * Re-resolve a stored URL through the active backend. Handles three shapes:
 *   - Local relative URLs:  /api/uploads/<key>          → key
 *   - R2 signed URLs:       https://<host>/<bucket>/<key>?... → key
 *   - R2 public URLs:       https://<R2_PUBLIC_URL>/<key>     → key
 *
 * Used to refresh URLs that may have been captured at write-time (e.g. an
 * imageInput stored in `assets.parameters`) so they don't 403 once a presign
 * expires. Returns null if the URL format is unrecognized — caller should
 * fall back to the original URL in that case.
 */
export async function refreshUrl(storedUrl: string): Promise<string | null> {
  try {
    // Local backend stores relative URLs like `/api/uploads/<key>`.
    if (storedUrl.startsWith("/api/uploads/")) {
      const key = storedUrl.slice("/api/uploads/".length).split("?")[0];
      if (!key) return null;
      return getAssetUrl(key);
    }

    const url = new URL(storedUrl);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const bucket = process.env.R2_BUCKET_NAME;
    let key: string;
    if (bucket && pathParts[0] === bucket) {
      // Signed R2 URL — first segment is the bucket
      key = pathParts.slice(1).join("/");
    } else {
      // Public R2 URL — key is the full path
      key = pathParts.join("/");
    }
    if (!key) return null;
    return getAssetUrl(key);
  } catch (err) {
    console.error("[refreshUrl] Failed to refresh URL:", err);
    return null;
  }
}

/**
 * Re-sign all URLs in a stringified `imageInput` value (single string or
 * string[]). Falls back to the original URL when refresh fails — better a
 * stale link than a missing one.
 */
export async function refreshImageInputUrls(
  imageInput: unknown
): Promise<unknown> {
  if (!imageInput) return imageInput;
  if (typeof imageInput === "string") {
    return (await refreshUrl(imageInput)) ?? imageInput;
  }
  if (Array.isArray(imageInput)) {
    return Promise.all(
      imageInput.map(async (v) =>
        typeof v === "string" ? ((await refreshUrl(v)) ?? v) : v
      )
    );
  }
  return imageInput;
}

/**
 * Encode a full-resolution WebP "display" variant for an image asset
 * (PR `feat/webp-image-delivery-backend`, T008).
 *
 * Decision rules baked in here:
 *   - Lossless when `sharp.metadata().hasAlpha === true` (typical for
 *     OpenAI gpt-image cutouts) — avoids halos around transparent edges.
 *   - Otherwise lossy quality 85 — consensus sweet spot.
 *
 * NEVER throws. Wraps every Sharp call in try/catch and returns the
 * `{ ok: false, reason }` discriminator so the upload/generate routes
 * can persist the asset row with `webpStatus = 'failed'` and continue
 * (FR-013 — encoder failure must not block the asset write).
 */
export async function encodeDisplayWebp(
  buffer: Buffer,
  mimeType: string
): Promise<
  | { ok: true; buffer: Buffer; size: number; usedLossless: boolean }
  | { ok: false; reason: string }
> {
  try {
    // Skip non-images defensively. Callers should already gate on
    // mediaType === 'image', but this is the seam — keep it bulletproof.
    if (!mimeType.startsWith("image/")) {
      return { ok: false, reason: `unsupported_mime_type: ${mimeType}` };
    }
    const meta = await sharp(buffer).metadata();
    const usedLossless = meta.hasAlpha === true;
    const out = usedLossless
      ? await sharp(buffer).webp({ lossless: true }).toBuffer()
      : await sharp(buffer).webp({ quality: 85 }).toBuffer();
    return { ok: true, buffer: out, size: out.length, usedLossless };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  }
}

/**
 * Derive the WebP display variant's R2 key from the original asset key.
 * Centralized so the upload route, generate route, and backfill script all
 * agree on the layout (`{originalKey}_display.webp`).
 */
export function displayWebpKey(originalKey: string): string {
  return originalKey.replace(/\.[^.]+$/, "_display.webp");
}

/**
 * Generate a thumbnail and upload it.
 * Returns the thumbnail storage key.
 */
export async function generateAndUploadThumbnail(
  imageBuffer: Buffer,
  originalKey: string
): Promise<string> {
  const thumbnailBuffer = await sharp(imageBuffer)
    .resize(THUMBNAIL_WIDTH, undefined, { fit: "inside" })
    .webp({ quality: 80 })
    .toBuffer();

  const thumbnailKey = originalKey.replace(/\.[^.]+$/, "_thumb.webp");
  await uploadFile(thumbnailBuffer, thumbnailKey, "image/webp");
  return thumbnailKey;
}

/**
 * Full pipeline: upload an image + generate thumbnail.
 */
export async function uploadAsset(
  imageBuffer: Buffer,
  userId: string,
  ext: string = "png"
) {
  const key = generateKey(userId, ext);
  const contentType =
    ext === "webp"
      ? "image/webp"
      : ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : "image/png";

  const metadata = await sharp(imageBuffer).metadata();
  const url = await uploadFile(imageBuffer, key, contentType);
  const thumbnailKey = await generateAndUploadThumbnail(imageBuffer, key);

  return {
    key,
    url,
    thumbnailKey,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    fileSize: imageBuffer.length,
  };
}

/**
 * Upload a video buffer + generate a poster thumbnail.
 */
export async function uploadVideoAsset(
  videoBuffer: Buffer,
  userId: string,
  options?: {
    posterUrl?: string;
    posterBuffer?: Buffer;
  }
) {
  const key = generateKey(userId, "mp4");
  const url = await uploadFile(videoBuffer, key, "video/mp4");

  let thumbnailKey: string | undefined;

  if (options?.posterBuffer) {
    const thumb = await sharp(options.posterBuffer)
      .resize(THUMBNAIL_WIDTH, undefined, { fit: "inside" })
      .webp({ quality: 80 })
      .toBuffer();
    thumbnailKey = key.replace(/\.[^.]+$/, "_thumb.webp");
    await uploadFile(thumb, thumbnailKey, "image/webp");
  } else if (options?.posterUrl) {
    try {
      const posterRes = await fetch(options.posterUrl);
      if (posterRes.ok) {
        const posterBuf = Buffer.from(await posterRes.arrayBuffer());
        const thumb = await sharp(posterBuf)
          .resize(THUMBNAIL_WIDTH, undefined, { fit: "inside" })
          .webp({ quality: 80 })
          .toBuffer();
        thumbnailKey = key.replace(/\.[^.]+$/, "_thumb.webp");
        await uploadFile(thumb, thumbnailKey, "image/webp");
      }
    } catch {
      // Poster download failed — proceed without thumbnail
    }
  }

  return {
    key,
    url,
    thumbnailKey,
    fileSize: videoBuffer.length,
  };
}

/**
 * Download a video from a URL and upload to storage.
 */
export async function downloadAndUploadVideo(
  videoUrl: string,
  userId: string,
  options?: {
    posterUrl?: string;
  }
) {
  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`Failed to download video (${response.status})`);
  }
  const videoBuffer = Buffer.from(await response.arrayBuffer());
  return uploadVideoAsset(videoBuffer, userId, options);
}
