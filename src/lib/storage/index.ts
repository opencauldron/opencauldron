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
