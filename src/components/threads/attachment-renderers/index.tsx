"use client";

import { memo } from "react";
import type { ClientMessageAttachment } from "../types";
import { AssetRefAttachment } from "./asset-ref-attachment";
import { ExternalLinkAttachment } from "./external-link-attachment";
import { UploadAttachmentCluster } from "./upload-attachment";

// ---------------------------------------------------------------------------
// Attachment renderer dispatcher.
//
// One message can mix `upload`, `asset_ref`, and `external_link`. Layout
// concerns:
//   * `upload` attachments form a single tile cluster (1/2/3+ rules from
//     spec line 53). They render in their natural `position` order.
//   * `asset_ref` and `external_link` render as full-width cards stacked
//     below the upload cluster (one card per row), sorted by `position`.
//
// Splitting the kinds keeps the upload cluster's grid math simple — mixing
// a square thumbnail next to a 12px-tall rich card looks bad in a 2-up grid.
// ---------------------------------------------------------------------------

export interface MessageAttachmentsProps {
  attachments: ClientMessageAttachment[];
}

function MessageAttachmentsImpl({ attachments }: MessageAttachmentsProps) {
  if (attachments.length === 0) return null;

  const sorted = attachments.slice().sort((a, b) => a.position - b.position);
  const uploads = sorted.filter((a) => a.kind === "upload");
  const cards = sorted.filter((a) => a.kind !== "upload");

  return (
    <>
      {uploads.length > 0 ? (
        <UploadAttachmentCluster attachments={uploads} />
      ) : null}
      {cards.length > 0 ? (
        <div data-slot="attachment-cards" className="mt-1.5 flex flex-col gap-1.5">
          {cards.map((a) => {
            if (a.kind === "asset_ref" && a.assetId) {
              return (
                <AssetRefAttachment
                  key={a.id}
                  assetId={a.assetId}
                  fallbackDisplayName={a.displayName}
                />
              );
            }
            if (a.kind === "external_link" && a.url) {
              return (
                <ExternalLinkAttachment
                  key={a.id}
                  url={a.url}
                  fallbackDisplayName={a.displayName}
                />
              );
            }
            return null;
          })}
        </div>
      ) : null}
    </>
  );
}

export const MessageAttachments = memo(MessageAttachmentsImpl);

// Re-export the leaf renderers so `MessageAttachments` consumers can
// override at finer granularity if needed.
export { AssetRefAttachment } from "./asset-ref-attachment";
export { ExternalLinkAttachment } from "./external-link-attachment";
export { UploadAttachmentCluster } from "./upload-attachment";
