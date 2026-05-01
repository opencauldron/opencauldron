"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ClientMessageAttachment } from "../types";

// ---------------------------------------------------------------------------
// Inline media tile cluster for `kind: "upload"` attachments (T046).
//
// Layout per spec (line 53):
//   1: full-width
//   2: side-by-side
//   3+: 2-up grid (rows of 2)
//
// Click any tile opens a minimal Dialog lightbox. We use the existing
// `<Dialog>` primitive — no separate viewer needed. Video tiles play inline
// (with a play-overlay glyph until hover/click); the lightbox embeds a full
// `<video controls>` so the user can scrub.
// ---------------------------------------------------------------------------

export interface UploadAttachmentClusterProps {
  attachments: ClientMessageAttachment[];
}

export function UploadAttachmentCluster({
  attachments,
}: UploadAttachmentClusterProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (attachments.length === 0) return null;
  const open = openIndex !== null ? attachments[openIndex] : null;

  return (
    <>
      <div
        data-slot="upload-cluster"
        data-count={attachments.length}
        className={cn(
          "mt-1.5 grid gap-1.5 overflow-hidden rounded-lg",
          attachments.length === 1 && "grid-cols-1",
          attachments.length === 2 && "grid-cols-2",
          attachments.length >= 3 && "grid-cols-2"
        )}
      >
        {attachments.map((a, i) => (
          <UploadTile
            key={a.id}
            attachment={a}
            // For 1-tile clusters, give the row a tighter cap so a tall
            // image doesn't flood the panel.
            isSolo={attachments.length === 1}
            onOpen={() => setOpenIndex(i)}
          />
        ))}
      </div>

      <Dialog
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpenIndex(null);
        }}
      >
        <DialogContent className="max-w-3xl gap-0 p-0">
          <DialogTitle className="sr-only">
            {open?.displayName ?? "Attachment preview"}
          </DialogTitle>
          {open ? <Lightbox attachment={open} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function UploadTile({
  attachment,
  isSolo,
  onOpen,
}: {
  attachment: ClientMessageAttachment;
  isSolo: boolean;
  onOpen: () => void;
}) {
  const isVideo = attachment.mimeType?.startsWith("video/");
  const url = attachment.r2Url ?? "";

  return (
    <button
      type="button"
      onClick={onOpen}
      data-slot="upload-tile"
      aria-label={
        isVideo
          ? `Play ${attachment.displayName ?? "video"}`
          : `Open ${attachment.displayName ?? "image"}`
      }
      className={cn(
        "group/tile relative block overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10",
        // Aspect cap: solo images get a generous cap; clustered ones use a
        // square so the 2-up grid stays even.
        isSolo ? "max-h-80 [&_img]:max-h-80" : "aspect-square",
        "active:translate-y-px"
      )}
    >
      {isVideo ? (
        <>
          <video
            src={url}
            muted
            playsInline
            preload="metadata"
            className={cn(
              "size-full object-cover",
              isSolo && "max-h-80 object-contain"
            )}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/30 opacity-100 transition-opacity group-hover/tile:opacity-0"
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-background/80 ring-1 ring-foreground/10">
              <Play className="size-4 fill-foreground text-foreground" aria-hidden />
            </span>
          </span>
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={attachment.displayName ?? "Image attachment"}
          className={cn(
            "size-full object-cover",
            isSolo && "max-h-80 object-contain"
          )}
          loading="lazy"
          decoding="async"
        />
      )}
    </button>
  );
}

function Lightbox({ attachment }: { attachment: ClientMessageAttachment }) {
  const isVideo = attachment.mimeType?.startsWith("video/");
  const url = attachment.r2Url ?? "";
  return (
    <div className="bg-background">
      {isVideo ? (
        <video
          src={url}
          controls
          autoPlay
          className="block max-h-[80vh] w-full bg-black"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={attachment.displayName ?? "Image preview"}
          className="block max-h-[80vh] w-full bg-black object-contain"
        />
      )}
      {attachment.displayName ? (
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          {attachment.displayName}
        </div>
      ) : null}
    </div>
  );
}
