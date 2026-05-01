"use client";

/**
 * AssetDownloadButton — split-button download UX for Library + Gallery.
 *
 * Per spec US3 (webp-image-delivery), this is the single shared download
 * component used by every asset surface. It has three render modes driven by
 * `asset.webpStatus` and `asset.kind`:
 *
 *   ready  (image)      → desktop split button: primary downloads WebP,
 *                          chevron opens menu with WebP + Original.
 *                          mobile: single full-width trigger that ALWAYS opens
 *                          the menu (no separate primary action) — WCAG 2.5.5
 *                          AAA target size.
 *   pending (image)     → same split layout but primary is disabled with a
 *                          spinner; chevron still works so users can grab the
 *                          original immediately.
 *   failed | null       → single original-only button. No menu. The WebP
 *   OR kind=video         encode failure is invisible to the user.
 *
 * The mobile branch is detected via Tailwind `md:` breakpoint and the
 * `pointer-coarse` media query (no JS device sniffing) — see the
 * conditional class structure below.
 *
 * Telemetry: every successful download fires `asset_downloaded` via
 * `trackEvent` (FR-011). Filenames follow `cauldron-{id8}.webp` for WebP and
 * `cauldron-{id8}-original.{ext}` for originals (FR-010).
 */

import * as React from "react";
import { ChevronDown, Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Subset of an asset record that the download button needs. Library + Gallery
 * DTOs both already carry these fields after PR 1's API hydration; callers
 * pass exactly this shape (no need to widen — keeping the surface narrow keeps
 * the component reusable).
 */
export interface DownloadableAsset {
  id: string;
  webpUrl: string | null;
  webpFileSize: number | null;
  webpStatus: "pending" | "ready" | "failed" | null;
  originalUrl: string;
  originalFileSize: number;
  originalMimeType: string | null;
  kind: "image" | "video";
}

export interface AssetDownloadButtonProps {
  asset: DownloadableAsset;
  /** Funnels into the PostHog `asset_downloaded` event so we can split usage by surface. */
  source: "library" | "gallery";
  /** Optional override for the desktop primary button's variant. */
  variant?: "default" | "secondary" | "outline";
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render byte counts as `1.4 MB` / `812 KB` etc. Inlined to avoid pulling in
 * a 3rd-party formatter for one screen of UI. Uses binary units (1024) to
 * match what the OS shows in Downloads folders.
 */
function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  // < 10 → one decimal (1.4 MB), >= 10 → integer (14 MB) — matches Finder.
  const formatted = value < 10 && unitIndex > 0 ? value.toFixed(1) : Math.round(value).toString();
  return `${formatted} ${units[unitIndex]}`;
}

/** Crude mime-type → extension. Falls back to `bin` so the filename is still usable. */
function extensionFor(mimeType: string | null): string {
  if (!mimeType) return "bin";
  const lower = mimeType.toLowerCase();
  if (lower === "image/jpeg" || lower === "image/jpg") return "jpg";
  if (lower === "image/png") return "png";
  if (lower === "image/webp") return "webp";
  if (lower === "image/gif") return "gif";
  if (lower === "image/avif") return "avif";
  if (lower === "image/heic") return "heic";
  if (lower === "video/mp4") return "mp4";
  if (lower === "video/webm") return "webm";
  if (lower === "video/quicktime") return "mov";
  // Fall back to whatever's after the slash (e.g., `image/foo` → `foo`).
  const slash = lower.indexOf("/");
  return slash >= 0 ? lower.slice(slash + 1).split(/[+;]/)[0] : "bin";
}

/** First 8 chars of the asset id — matches the `cauldron-{id8}` filename scheme. */
function id8(id: string): string {
  return id.slice(0, 8);
}

/**
 * Cross-origin-safe download via fetch + blob + synthetic anchor click.
 *
 * The simpler `<a href={url} download={name}>` pattern works only when the
 * URL is same-origin OR the server sends `Content-Disposition: attachment`.
 * R2-signed URLs are cross-origin and don't always set that header, so the
 * browser ignores `download` and navigates instead. Round-tripping through a
 * Blob sidesteps this and guarantees the filename is honored.
 */
async function downloadAs(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Defer revoke a tick so the click handler has time to start the download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AssetDownloadButton({
  asset,
  source,
  variant = "default",
  className,
}: AssetDownloadButtonProps) {
  const [busy, setBusy] = React.useState<"webp" | "original" | null>(null);

  const isVideo = asset.kind === "video";
  const webpReady = asset.webpStatus === "ready" && !!asset.webpUrl && !!asset.webpFileSize;
  const webpPending = asset.webpStatus === "pending" && !isVideo;
  // "Single button" mode: video, failed encode, or never-encoded.
  const singleOnly = isVideo || (!webpReady && !webpPending);

  const originalExt = extensionFor(asset.originalMimeType ?? (isVideo ? "video/mp4" : null));
  const webpSizeLabel = formatBytes(asset.webpFileSize);
  const originalSizeLabel = formatBytes(asset.originalFileSize);

  // Stable callbacks — `useCallback` so the menu items don't re-render
  // gratuitously when the parent renders.
  const handleDownloadWebp = React.useCallback(async () => {
    if (!asset.webpUrl || !asset.webpFileSize) return;
    setBusy("webp");
    try {
      await downloadAs(asset.webpUrl, `cauldron-${id8(asset.id)}.webp`);
      trackEvent("asset_downloaded", {
        format: "webp",
        sizeBytes: asset.webpFileSize,
        source,
        assetId: asset.id,
      });
    } catch (err) {
      // Surface as a console error; UX-level toast is the caller's choice.
      // (Library/Gallery already use sonner globally — they can wrap if needed.)
      console.error("WebP download failed", err);
    } finally {
      setBusy(null);
    }
  }, [asset.id, asset.webpUrl, asset.webpFileSize, source]);

  const handleDownloadOriginal = React.useCallback(async () => {
    setBusy("original");
    try {
      await downloadAs(
        asset.originalUrl,
        `cauldron-${id8(asset.id)}-original.${originalExt}`
      );
      trackEvent("asset_downloaded", {
        format: "original",
        sizeBytes: asset.originalFileSize,
        source,
        assetId: asset.id,
      });
    } catch (err) {
      console.error("Original download failed", err);
    } finally {
      setBusy(null);
    }
  }, [asset.id, asset.originalUrl, asset.originalFileSize, originalExt, source]);

  // -------------------------------------------------------------------------
  // Render mode 3: single button (failed | null | video)
  // -------------------------------------------------------------------------
  if (singleOnly) {
    return (
      <Button
        variant={variant}
        size="default"
        onClick={handleDownloadOriginal}
        disabled={busy === "original"}
        className={cn(
          // Touch target ≥44px on coarse pointers / mobile (WCAG 2.5.5 AAA).
          "min-h-11 md:min-h-0 w-full md:w-auto",
          className
        )}
        aria-label={`Download ${formatBytes(asset.originalFileSize)}`}
      >
        {busy === "original" ? (
          <Loader2 className="animate-spin" />
        ) : (
          <Download />
        )}
        <span>Download · {originalSizeLabel}</span>
      </Button>
    );
  }

  // -------------------------------------------------------------------------
  // Render modes 1 & 2: WebP ready or pending — split button on desktop,
  // single full-width menu trigger on mobile.
  // -------------------------------------------------------------------------
  const menu = (
    <DropdownMenuContent align="end" sideOffset={6} className="min-w-[260px]">
      <DropdownMenuItem
        onClick={handleDownloadWebp}
        disabled={!webpReady || busy !== null}
      >
        <Download />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm">
            Compressed (WebP) · {webpSizeLabel}
          </span>
          <span className="text-xs text-muted-foreground">
            best for sharing
          </span>
        </div>
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={handleDownloadOriginal}
        disabled={busy !== null}
      >
        <Download />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm">
            Original ({originalExt.toUpperCase()}) · {originalSizeLabel}
          </span>
          <span className="text-xs text-muted-foreground">max quality</span>
        </div>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  return (
    <div className={cn("inline-flex w-full md:w-auto", className)}>
      {/*
        DESKTOP: split button — primary action + chevron menu.
        Shown only when viewport is ≥ md AND the primary pointer is fine
        (mouse/trackpad). Touch-first devices fall through to the mobile
        single-trigger branch below regardless of viewport width.
      */}
      <div
        data-slot="asset-download-desktop"
        className={cn(
          "hidden md:inline-flex",
          // Force-hide on coarse-pointer devices (touch tablets) at any width.
          "[@media(pointer:coarse)]:hidden!"
        )}
      >
        <div className="inline-flex items-stretch">
          <Button
            variant={variant}
            size="default"
            onClick={handleDownloadWebp}
            disabled={!webpReady || busy !== null}
            className="rounded-r-none border-r-0"
            aria-label={
              webpPending
                ? "WebP download preparing"
                : `Download WebP ${webpSizeLabel}`
            }
          >
            {busy === "webp" || webpPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Download />
            )}
            <span>Download · {webpReady ? webpSizeLabel : "preparing…"}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant={variant}
                  size="default"
                  className="rounded-l-none px-2"
                  aria-label="Download options"
                />
              }
              disabled={busy !== null}
            >
              <ChevronDown />
            </DropdownMenuTrigger>
            {menu}
          </DropdownMenu>
        </div>
      </div>

      {/*
        MOBILE / coarse-pointer: single full-width trigger that always opens
        the menu. ≥44px tall to satisfy WCAG 2.5.5 AAA touch targets.
      */}
      <div
        data-slot="asset-download-mobile"
        className={cn(
          "inline-flex w-full md:hidden",
          // Force-show on coarse-pointer devices even at md+.
          "[@media(pointer:coarse)]:inline-flex!"
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant={variant}
                size="default"
                className="min-h-11 w-full"
                aria-label="Download options"
              />
            }
            disabled={busy !== null}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Download />}
            <span>
              Download ·{" "}
              {webpReady ? webpSizeLabel : webpPending ? "preparing…" : originalSizeLabel}
            </span>
            <ChevronDown className="ml-auto" />
          </DropdownMenuTrigger>
          {menu}
        </DropdownMenu>
      </div>
    </div>
  );
}

// Re-export helpers for tests / future composition. Not part of the public
// surface but cheap to expose and prevents accidental duplication.
export { formatBytes as __formatBytes, extensionFor as __extensionFor };
