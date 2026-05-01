"use client";

import { memo } from "react";
import {
  AlertCircle,
  FileVideo,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  RefreshCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Composer pending-attachment tile (T044). Pure presentational.
//
// One tile per pending attachment. Tile state is the union of the four phases:
//   * `pending`   — accepted client-side, upload not started yet
//   * `uploading` — POST in flight; show a progress spinner
//   * `uploaded`  — server returned R2 metadata; thumbnail loaded
//   * `error`     — upload failed; offer retry + remove
//
// Owns nothing; the composer drives state and reaches in via callbacks.
// Layout: 64×64 tile with a tiny X (remove) overlay; for `error`, swap the
// thumbnail surface for a retry button. For `asset_ref` tiles, show a small
// "Library" badge in the corner so the user knows what it'll render as.
// ---------------------------------------------------------------------------

export type ComposerAttachmentKind = "upload" | "asset_ref";

export interface ComposerAttachment {
  /** Stable client id — random uuid, not the server-side r2 key. */
  clientId: string;
  kind: ComposerAttachmentKind;
  status: "pending" | "uploading" | "uploaded" | "error";
  /**
   * For `upload`: a local `URL.createObjectURL(file)` preview when image/gif,
   * the placeholder icon when video. For `asset_ref`: the asset's thumbnail.
   */
  previewUrl: string | null;
  fileName: string;
  /** "image", "video", or "asset_ref" — drives the icon/badge. */
  mediaKind: "image" | "video" | "asset_ref";
  /**
   * Size of the originating `File` for `upload` kind, in bytes. Carried on the
   * attachment record so the aggregate-bytes calculation doesn't need to
   * peek at a ref during render. `null` for `asset_ref`.
   */
  fileSize: number | null;
  /** When `error`: a short human reason for the user. */
  errorMessage?: string;
  /**
   * Server response payload — populated when `status === "uploaded"`. The
   * composer uses this to build the `attachments[]` array on POST.
   */
  uploaded?:
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
    | { kind: "asset_ref"; assetId: string };
}

export interface ComposerAttachmentTileProps {
  attachment: ComposerAttachment;
  onRemove: (clientId: string) => void;
  /** Only meaningful for `status: "error"`. */
  onRetry?: (clientId: string) => void;
}

function ComposerAttachmentTileImpl({
  attachment,
  onRemove,
  onRetry,
}: ComposerAttachmentTileProps) {
  const { status, kind, previewUrl, fileName, mediaKind, errorMessage } =
    attachment;
  const showSpinner = status === "uploading" || status === "pending";
  const isImagePreview =
    (mediaKind === "image" || mediaKind === "asset_ref") && previewUrl;
  const isVideoPreview = mediaKind === "video" && previewUrl;

  return (
    <div
      data-slot="composer-attachment-tile"
      data-status={status}
      data-kind={kind}
      className={cn(
        "group/tile relative size-16 shrink-0 overflow-hidden rounded-md bg-muted",
        "ring-1 ring-foreground/10",
        status === "error" && "ring-destructive/40"
      )}
      title={fileName}
    >
      {/* Preview surface */}
      {status === "error" ? (
        <div className="flex size-full flex-col items-center justify-center gap-1 bg-destructive/10 px-1 text-center">
          <AlertCircle className="size-4 text-destructive" aria-hidden />
          <span className="line-clamp-2 text-[10px] leading-tight text-destructive">
            {errorMessage ?? "Upload failed"}
          </span>
        </div>
      ) : isImagePreview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt={fileName}
          className={cn(
            "size-full object-cover transition-opacity",
            status !== "uploaded" && "opacity-50"
          )}
        />
      ) : isVideoPreview ? (
        // Native preview wouldn't decode the local blob without a load event
        // — for the tile we show a video glyph + filename caption.
        <div className="flex size-full flex-col items-center justify-center gap-0.5 text-muted-foreground">
          <FileVideo className="size-5" aria-hidden />
          <span className="line-clamp-1 px-1 text-[10px] tabular-nums">
            video
          </span>
        </div>
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          {mediaKind === "video" ? (
            <FileVideo className="size-5" aria-hidden />
          ) : (
            <ImageIcon className="size-5" aria-hidden />
          )}
        </div>
      )}

      {/* Status overlay — spinner for in-flight, library glyph for asset_ref */}
      {showSpinner ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-[1px]">
          <Loader2
            className="size-4 animate-spin text-foreground"
            aria-label={status === "uploading" ? "Uploading" : "Pending"}
          />
        </div>
      ) : null}
      {kind === "asset_ref" && status === "uploaded" ? (
        <span
          aria-hidden
          className={cn(
            "absolute bottom-0 left-0 right-0 flex items-center gap-0.5 bg-background/80 px-1 py-0.5",
            "text-[10px] font-medium uppercase tracking-wide text-foreground/70"
          )}
        >
          <Paperclip className="size-2.5" aria-hidden />
          Library
        </span>
      ) : null}

      {/* Action buttons — top-right cluster, hover-revealed (focus-within
          parity for keyboard) */}
      <div
        className={cn(
          "absolute right-0.5 top-0.5 flex items-center gap-0.5 opacity-0 transition-opacity",
          "group-hover/tile:opacity-100 group-focus-within/tile:opacity-100",
          status === "error" && "opacity-100"
        )}
      >
        {status === "error" && onRetry ? (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="size-5 rounded-full bg-background/90 shadow-sm hover:bg-background"
            onClick={() => onRetry(attachment.clientId)}
            aria-label={`Retry uploading ${fileName}`}
          >
            <RefreshCcw aria-hidden className="size-3" />
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="size-5 rounded-full bg-background/90 shadow-sm hover:bg-destructive/15 hover:text-destructive"
          onClick={() => onRemove(attachment.clientId)}
          aria-label={`Remove ${fileName}`}
        >
          <X aria-hidden className="size-3" />
        </Button>
      </div>
    </div>
  );
}

export const ComposerAttachmentTile = memo(ComposerAttachmentTileImpl);
