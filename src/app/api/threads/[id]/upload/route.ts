/**
 * POST /api/threads/[id]/upload — multipart attachment upload (T021).
 *
 * Validates MIME via the existing `validateAssetUpload` (which already
 * accepts `image/gif`). Streams to R2 under `threads/<threadId>/<tempId>/
 * <filename>`. Returns the metadata needed for the composer to attach the
 * upload to the next message — the row is NOT linked to a message yet.
 *
 * The composer collects these blobs and POSTs them as `attachments[].kind =
 * 'upload'` when the user submits. Linkage in `message_attachments` happens
 * at message-create time. Orphan blobs (uploaded but never attached) get
 * cleaned up by the Phase 6 sweeper.
 */

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { nanoid } from "nanoid";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { uploadFile } from "@/lib/storage";
import {
  PermissionError,
  assertWorkspaceMemberForThread,
} from "@/lib/threads/permissions";
import { validateAssetUpload } from "@/app/api/uploads/validation";
import { checkUserDailyStorageQuota } from "@/lib/threads/storage-quota";

export const runtime = "nodejs";

const EXT_MAP: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

function safeFilename(name: string): string {
  // Strip directory traversal + non-printable bytes; cap length.
  return name.replace(/[\x00-\x1f\\/]/g, "_").slice(0, 200) || "upload";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: threadId } = await params;

  try {
    await assertWorkspaceMemberForThread(userId, threadId);
  } catch (err) {
    if (err instanceof PermissionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
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

  // Per-user trailing-24h soft-cap (T054). Reject before reading the body so
  // a user mid-flood doesn't waste bandwidth on bytes we won't accept.
  const quota = await checkUserDailyStorageQuota({
    userId,
    candidateBytes: file.size,
    limitBytes: env.THREAD_USER_DAILY_STORAGE_BYTES,
  });
  if (quota.overLimit) {
    return NextResponse.json(
      {
        error: "storage_quota_exceeded",
        usedBytes: quota.usedBytes,
        limitBytes: quota.limitBytes,
        retryAfterSeconds: quota.retryAfterSeconds,
      },
      {
        status: 413,
        headers: quota.retryAfterSeconds
          ? { "Retry-After": String(quota.retryAfterSeconds) }
          : undefined,
      }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = EXT_MAP[file.type] ?? "bin";
  const tempId = nanoid(10);
  const filename = safeFilename(file.name || `upload.${ext}`);
  const key = `threads/${threadId}/${tempId}/${filename}`;

  const url = await uploadFile(buffer, key, file.type);

  // Pull dimensions for image uploads — composer uses them to reserve
  // layout space pre-load. Video probing is more expensive (ffmpeg) so we
  // skip it in v1 and let the player report dims on metadata.
  let width: number | null = null;
  let height: number | null = null;
  if (isImage) {
    try {
      const meta = await sharp(buffer).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch {
      // Non-fatal — Sharp may not understand a particular GIF variant.
    }
  }

  return NextResponse.json({
    kind: "upload" as const,
    r2Key: key,
    r2Url: url,
    mimeType: file.type,
    fileSize: buffer.length,
    width,
    height,
    displayName: file.name || null,
  });
}
