import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";
import { nanoid } from "nanoid";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME!;
const THUMBNAIL_WIDTH = 400;

/**
 * Generate a storage key for an asset.
 */
function generateKey(userId: string, ext: string = "png"): string {
  const timestamp = Date.now();
  const id = nanoid(10);
  return `assets/${userId}/${timestamp}-${id}.${ext}`;
}

/**
 * Upload a buffer to R2.
 */
export async function uploadToR2(
  buffer: Buffer,
  key: string,
  contentType: string = "image/png"
): Promise<string> {
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  // Return public URL if configured, otherwise use signed URL
  if (process.env.R2_PUBLIC_URL) {
    return `${process.env.R2_PUBLIC_URL}/${key}`;
  }
  return getAssetSignedUrl(key);
}

/**
 * Generate a signed URL for private asset access (1 hour expiry).
 */
export async function getAssetSignedUrl(key: string): Promise<string> {
  return getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: 3600 }
  );
}

/**
 * Delete an asset from R2.
 */
export async function deleteFromR2(key: string): Promise<void> {
  await r2.send(
    new DeleteObjectCommand({ Bucket: BUCKET, Key: key })
  );
}

/**
 * Generate a thumbnail and upload it to R2.
 * Returns the thumbnail R2 key.
 */
export async function generateAndUploadThumbnail(
  imageBuffer: Buffer,
  originalKey: string
): Promise<string> {
  const thumbnailBuffer = await sharp(imageBuffer)
    .resize(THUMBNAIL_WIDTH, undefined, { fit: "inside" })
    .webp({ quality: 80 })
    .toBuffer();

  const thumbnailKey = originalKey.replace(
    /\.[^.]+$/,
    "_thumb.webp"
  );

  await uploadToR2(thumbnailBuffer, thumbnailKey, "image/webp");
  return thumbnailKey;
}

/**
 * Full pipeline: upload an image + generate thumbnail.
 * Returns { key, url, thumbnailKey, width, height, fileSize }.
 */
export async function uploadAsset(
  imageBuffer: Buffer,
  userId: string,
  ext: string = "png"
) {
  const key = generateKey(userId, ext);
  const contentType = ext === "webp" ? "image/webp" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";

  // Get image metadata
  const metadata = await sharp(imageBuffer).metadata();

  // Upload full image
  const url = await uploadToR2(imageBuffer, key, contentType);

  // Generate and upload thumbnail
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
 * Upload a video buffer to R2 + generate a poster thumbnail.
 *
 * For the thumbnail, we accept an optional posterUrl from the provider.
 * If none is supplied we create a simple placeholder thumbnail.
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
  const url = await uploadToR2(videoBuffer, key, "video/mp4");

  let thumbnailKey: string | undefined;

  // Use poster from provider if available
  if (options?.posterBuffer) {
    const thumb = await sharp(options.posterBuffer)
      .resize(THUMBNAIL_WIDTH, undefined, { fit: "inside" })
      .webp({ quality: 80 })
      .toBuffer();
    thumbnailKey = key.replace(/\.[^.]+$/, "_thumb.webp");
    await uploadToR2(thumb, thumbnailKey, "image/webp");
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
        await uploadToR2(thumb, thumbnailKey, "image/webp");
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
 * Download a video from a URL and upload to R2.
 * Used when providers return a temporary download URL.
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
