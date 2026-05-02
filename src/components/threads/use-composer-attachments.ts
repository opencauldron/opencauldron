"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ComposerAttachment } from "./composer-attachment-tile";

// ---------------------------------------------------------------------------
// Composer attachment state machine (T045).
//
// Owns the attachment list + per-attachment lifecycle:
//   `pending` → `uploading` → `uploaded`  (happy path)
//                          ↘ `error`      (network / 4xx / 5xx)
//
// Aggregate validation (NFR-006):
//   * max 10 attachments per message
//   * max 25 MB per upload
//   * max 100 MB aggregate (sums uploaded + uploading bytes)
//
// `asset_ref` attachments enter directly as `uploaded` — no upload, no byte
// budget consumption (FR-009 spec line 96).
//
// MIME allowlist is enforced server-side by the existing `validateAssetUpload`
// helper. We pre-flight client-side too so a 25MB rejection doesn't waste an
// upload round-trip.
//
// State updates use functional setters everywhere (rerender-functional-setstate)
// so callbacks stay stable across renders.
// ---------------------------------------------------------------------------

export const MAX_ATTACHMENTS = 10;
export const MAX_BYTES_PER_UPLOAD = 25 * 1024 * 1024; // 25 MB
export const MAX_AGGREGATE_BYTES = 100 * 1024 * 1024; // 100 MB

const ALLOWED_UPLOAD_MIMES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

export interface AttachmentValidationError {
  reason:
    | "too_many_attachments"
    | "file_too_large"
    | "aggregate_too_large"
    | "mime_not_allowed";
  message: string;
}

export type ServerAttachmentPayload =
  | {
      kind: "upload";
      r2Key: string;
      r2Url: string;
      mimeType: string;
      fileSize: number;
      width: number | null;
      height: number | null;
      displayName: string | null;
    }
  | {
      kind: "asset_ref";
      assetId: string;
      displayName: string | null;
    };

export interface UseComposerAttachmentsArgs {
  threadId: string;
}

export interface UseComposerAttachmentsReturn {
  attachments: ComposerAttachment[];
  /** True iff send is gated on at least one in-flight attachment. */
  hasUnresolved: boolean;
  /** True iff any attachment is in `error` state. */
  hasError: boolean;
  /**
   * Add `File` objects to the queue (drag, paste, or file-picker). Returns
   * `{ ok, errors }` so the composer can surface partial-failure cases (5
   * files dropped, 1 over-cap → 4 accepted + 1 toast).
   */
  enqueueFiles: (files: File[]) => { accepted: number; errors: AttachmentValidationError[] };
  /** Add an `asset_ref` (from the library picker). Bypasses byte budget. */
  enqueueAssetRef: (input: {
    assetId: string;
    displayName: string | null;
    thumbnailUrl: string | null;
  }) => { ok: boolean; error?: AttachmentValidationError };
  /** Remove an attachment by client id (works in any state). */
  remove: (clientId: string) => void;
  /** Retry a failed upload — re-enters `uploading`. */
  retry: (clientId: string) => void;
  /** Reset to empty (called after a successful message send). */
  clear: () => void;
  /**
   * Returns the server-shape `attachments[]` array suitable for the
   * `POST /api/threads/<id>/messages` body. Excludes any attachment that
   * isn't in `uploaded` state — caller should gate send on `hasUnresolved`.
   */
  toServerPayload: () => ServerAttachmentPayload[];
}

interface UploadResponse {
  kind: "upload";
  r2Key: string;
  r2Url: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  displayName: string | null;
}

export function useComposerAttachments({
  threadId,
}: UseComposerAttachmentsArgs): UseComposerAttachmentsReturn {
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  // Track `File` objects keyed by clientId so we can retry uploads without
  // requiring the user to re-pick the file. Map is a ref because file
  // objects shouldn't trigger re-renders.
  const filesByIdRef = useRef<Map<string, File>>(new Map());

  // Free `URL.createObjectURL` blobs when the component unmounts so we don't
  // leak memory across many composer mounts.
  useEffect(() => {
    return () => {
      for (const a of attachments) {
        if (a.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(a.previewUrl);
        }
      }
    };
    // We deliberately only run cleanup on unmount; per-attachment removal
    // does its own revoke in `remove()` below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Aggregate-state derivations (cheap, no memo needed) ----------------
  // Size is carried on the attachment record itself (see `fileSize`) so we
  // don't need to read `filesByIdRef.current` during render — that triggers
  // the `react-hooks/refs` rule.
  const aggregateBytes = attachments.reduce((sum, a) => {
    if (a.kind === "asset_ref") return sum;
    return sum + (a.fileSize ?? 0);
  }, 0);

  const hasUnresolved = attachments.some(
    (a) => a.status === "pending" || a.status === "uploading"
  );
  const hasError = attachments.some((a) => a.status === "error");

  // ---- Validation helper --------------------------------------------------
  const validateFile = useCallback(
    (
      file: File,
      currentAttachments: ComposerAttachment[],
      bytesTakenSoFar: number
    ): AttachmentValidationError | null => {
      if (currentAttachments.length >= MAX_ATTACHMENTS) {
        return {
          reason: "too_many_attachments",
          message: `Max ${MAX_ATTACHMENTS} attachments per message.`,
        };
      }
      if (!ALLOWED_UPLOAD_MIMES.has(file.type)) {
        return {
          reason: "mime_not_allowed",
          message: "That file type isn't supported. Try a PNG, JPG, GIF, or MP4.",
        };
      }
      if (file.size > MAX_BYTES_PER_UPLOAD) {
        return {
          reason: "file_too_large",
          message: `Files larger than ${formatMb(MAX_BYTES_PER_UPLOAD)} can't be attached.`,
        };
      }
      if (bytesTakenSoFar + file.size > MAX_AGGREGATE_BYTES) {
        return {
          reason: "aggregate_too_large",
          message: `Total attachments can't exceed ${formatMb(MAX_AGGREGATE_BYTES)} per message.`,
        };
      }
      return null;
    },
    []
  );

  // ---- Upload kick-off ----------------------------------------------------
  const performUpload = useCallback(
    async (clientId: string, file: File) => {
      setAttachments((prev) =>
        prev.map((a) =>
          a.clientId === clientId ? { ...a, status: "uploading" } : a
        )
      );
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(`/api/threads/${threadId}/upload`, {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const message = await safeUploadErrorMessage(res);
          setAttachments((prev) =>
            prev.map((a) =>
              a.clientId === clientId
                ? { ...a, status: "error", errorMessage: message }
                : a
            )
          );
          return;
        }
        const json = (await res.json()) as UploadResponse;
        setAttachments((prev) =>
          prev.map((a) =>
            a.clientId === clientId
              ? {
                  ...a,
                  status: "uploaded",
                  uploaded: json,
                }
              : a
          )
        );
      } catch {
        setAttachments((prev) =>
          prev.map((a) =>
            a.clientId === clientId
              ? {
                  ...a,
                  status: "error",
                  errorMessage: "Network error. Try again.",
                }
              : a
          )
        );
      }
    },
    [threadId]
  );

  // ---- Public API ---------------------------------------------------------

  const enqueueFiles = useCallback(
    (
      files: File[]
    ): { accepted: number; errors: AttachmentValidationError[] } => {
      const errors: AttachmentValidationError[] = [];
      let accepted = 0;

      // Validate each file against the *would-be* state (existing + accepted-
      // so-far). Accumulate into a local working list so multi-drop doesn't
      // need N intermediate setStates.
      let workingAttachments = attachments.slice();
      let workingBytes = aggregateBytes;
      const newAttachments: ComposerAttachment[] = [];
      const newFileEntries: Array<[string, File]> = [];

      for (const file of files) {
        const err = validateFile(file, workingAttachments, workingBytes);
        if (err) {
          errors.push(err);
          continue;
        }
        const clientId = crypto.randomUUID();
        const isImage =
          file.type.startsWith("image/") && file.type !== "image/gif"
            ? true
            : file.type === "image/gif";
        const previewUrl = isImage ? URL.createObjectURL(file) : null;
        const entry: ComposerAttachment = {
          clientId,
          kind: "upload",
          status: "pending",
          previewUrl,
          fileName: file.name || "untitled",
          mediaKind: file.type.startsWith("video/") ? "video" : "image",
          fileSize: file.size,
        };
        newAttachments.push(entry);
        newFileEntries.push([clientId, file]);
        workingAttachments = [...workingAttachments, entry];
        workingBytes += file.size;
        accepted += 1;
      }

      if (newAttachments.length > 0) {
        for (const [id, file] of newFileEntries) {
          filesByIdRef.current.set(id, file);
        }
        setAttachments((prev) => [...prev, ...newAttachments]);
        // Kick off uploads in parallel.
        for (const a of newAttachments) {
          const file = filesByIdRef.current.get(a.clientId);
          if (file) void performUpload(a.clientId, file);
        }
      }

      return { accepted, errors };
    },
    [attachments, aggregateBytes, performUpload, validateFile]
  );

  const enqueueAssetRef = useCallback(
    (input: {
      assetId: string;
      displayName: string | null;
      thumbnailUrl: string | null;
    }): { ok: boolean; error?: AttachmentValidationError } => {
      if (attachments.length >= MAX_ATTACHMENTS) {
        return {
          ok: false,
          error: {
            reason: "too_many_attachments",
            message: `Max ${MAX_ATTACHMENTS} attachments per message.`,
          },
        };
      }
      if (
        attachments.some(
          (a) => a.kind === "asset_ref" && a.uploaded?.kind === "asset_ref" && a.uploaded.assetId === input.assetId
        )
      ) {
        // Already attached — silently no-op.
        return { ok: true };
      }
      const clientId = crypto.randomUUID();
      const entry: ComposerAttachment = {
        clientId,
        kind: "asset_ref",
        status: "uploaded",
        previewUrl: input.thumbnailUrl,
        fileName: input.displayName ?? "Library asset",
        mediaKind: "asset_ref",
        fileSize: null,
        uploaded: { kind: "asset_ref", assetId: input.assetId },
      };
      setAttachments((prev) => [...prev, entry]);
      return { ok: true };
    },
    [attachments]
  );

  const remove = useCallback((clientId: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.clientId === clientId);
      if (target?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(target.previewUrl);
      }
      filesByIdRef.current.delete(clientId);
      return prev.filter((a) => a.clientId !== clientId);
    });
  }, []);

  const retry = useCallback(
    (clientId: string) => {
      const file = filesByIdRef.current.get(clientId);
      if (!file) {
        toast.error("Couldn't retry — original file is gone.");
        return;
      }
      void performUpload(clientId, file);
    },
    [performUpload]
  );

  const clear = useCallback(() => {
    setAttachments((prev) => {
      for (const a of prev) {
        if (a.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(a.previewUrl);
        }
      }
      filesByIdRef.current.clear();
      return [];
    });
  }, []);

  const toServerPayload = useCallback((): ServerAttachmentPayload[] => {
    const out: ServerAttachmentPayload[] = [];
    for (const a of attachments) {
      if (a.status !== "uploaded" || !a.uploaded) continue;
      if (a.uploaded.kind === "upload") {
        out.push({
          kind: "upload",
          r2Key: a.uploaded.r2Key,
          r2Url: a.uploaded.r2Url,
          mimeType: a.uploaded.mimeType,
          fileSize: a.uploaded.fileSize,
          width: a.uploaded.width,
          height: a.uploaded.height,
          displayName: a.uploaded.displayName,
        });
      } else {
        out.push({
          kind: "asset_ref",
          assetId: a.uploaded.assetId,
          displayName: a.fileName === "Library asset" ? null : a.fileName,
        });
      }
    }
    return out;
  }, [attachments]);

  return {
    attachments,
    hasUnresolved,
    hasError,
    enqueueFiles,
    enqueueAssetRef,
    remove,
    retry,
    clear,
    toServerPayload,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

async function safeUploadErrorMessage(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: string };
    if (res.status === 413 || json.error === "too_large") {
      return "File is too large. 25 MB max per upload.";
    }
    if (json.error === "mime_not_allowed" || json.error === "unsupported_mime") {
      return "File type isn't supported.";
    }
    if (res.status === 403) return "You don't have access to this thread.";
    return json.error ?? `Upload failed (status ${res.status}).`;
  } catch {
    return `Upload failed (status ${res.status}).`;
  }
}
