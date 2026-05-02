"use client";

import { ExternalLink, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// `external_link` attachment renderer (T048).
//
// Minimal v1 — no OpenGraph fetch, no preview, no favicon scrape. Just a
// link card with a globe glyph + the URL hostname + the click-out arrow.
// Anchors get `rel="noopener noreferrer"` + `target="_blank"` so we never
// leak `window.opener` to a third-party page.
//
// Phase 6 polish can add a server-side OpenGraph fetcher; for now the
// surface is intentionally cheap.
// ---------------------------------------------------------------------------

export interface ExternalLinkAttachmentProps {
  url: string;
  fallbackDisplayName?: string | null;
}

export function ExternalLinkAttachment({
  url,
  fallbackDisplayName,
}: ExternalLinkAttachmentProps) {
  const parsed = safeParseUrl(url);
  const host = parsed?.host ?? url;
  const display = fallbackDisplayName ?? host;

  return (
    <a
      data-slot="external-link-attachment"
      href={url}
      rel="noopener noreferrer"
      target="_blank"
      className={cn(
        "mt-1.5 inline-flex max-w-full items-center gap-2.5 rounded-lg bg-card p-1.5",
        "text-left ring-1 ring-foreground/10 transition-all",
        "hover:bg-accent hover:ring-foreground/15",
        "active:translate-y-px"
      )}
      aria-label={`Open ${display} in a new tab`}
    >
      <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground ring-1 ring-foreground/5">
        <Globe className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">
          {display}
        </div>
        <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
          {host}
        </div>
      </div>
      <ExternalLink
        className="mr-1 size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </a>
  );
}

function safeParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}
