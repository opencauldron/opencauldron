"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  Hash,
  Lock,
  Megaphone,
  Plus,
  RefreshCw,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LibraryAssetPickerDialog } from "@/components/threads/library-asset-picker-dialog";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// CampaignDetailClient — single-purpose page client. Owns:
//
//   - The asset grid (live fetch via /api/library?campaign=<id>; no infinite
//     scroll for v1, hard cap 200 results — campaigns are scoped by
//     definition and rarely exceed this).
//   - The bulk-add dialog wired to /api/campaigns/[id]/assets POST.
//   - The Generate-for-campaign deep-link.
//
// We intentionally don't reuse the Library URL-state machinery here: the
// page has a single locked filter (`?campaign=<id>`) and no facets. Pulling
// in the LibraryQueryProvider would just bloat the route.
// ---------------------------------------------------------------------------

interface Asset {
  id: string;
  url: string;
  thumbnailUrl: string;
  fileName: string | null;
  width: number | null;
  height: number | null;
  mediaType: "image" | "video";
  source: "uploaded" | "generated" | "imported";
  createdAt: string;
}

interface CampaignDetailClientProps {
  brandId: string;
  brandName: string;
  brandSlug: string;
  campaign: {
    id: string;
    name: string;
    description: string | null;
    startsAt: string | null;
    endsAt: string | null;
    visibility: "private" | "public";
    publicSlug: string | null;
  };
  publicSharingAvailable: boolean;
  canManageCampaign: boolean;
}

export function CampaignDetailClient({
  brandId,
  brandName,
  brandSlug,
  campaign,
  publicSharingAvailable,
  canManageCampaign,
}: CampaignDetailClientProps) {
  // Visibility state — server-rendered initial values, mutated through
  // POST /api/campaigns/[id]/visibility. We deliberately track this locally
  // (rather than calling router.refresh after every mutation) so the URL
  // field updates without a full RSC round-trip.
  const [visibility, setVisibility] = useState<"private" | "public">(
    campaign.visibility
  );
  const [publicSlug, setPublicSlug] = useState<string | null>(
    campaign.publicSlug
  );
  const [mutatingVisibility, setMutatingVisibility] = useState(false);
  const [copied, setCopied] = useState(false);
  const [items, setItems] = useState<Asset[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const publicUrl = useMemo(() => {
    if (visibility !== "public" || !publicSlug) return null;
    if (typeof window === "undefined") return null;
    return `${window.location.origin}/c/${brandSlug}/${publicSlug}`;
  }, [visibility, publicSlug, brandSlug]);

  const callVisibility = useCallback(
    async (action: "publish" | "unpublish" | "regenerate") => {
      const res = await fetch(`/api/campaigns/${campaign.id}/visibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        visibility?: "private" | "public";
        publicSlug?: string | null;
        url?: string | null;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        if (res.status === 412 && payload.error === "r2_public_url_unset") {
          throw new Error(
            payload.message ??
              "Public sharing isn't configured on this server."
          );
        }
        throw new Error(payload.error ?? payload.message ?? "Request failed");
      }
      return payload;
    },
    [campaign.id]
  );

  const handlePublish = useCallback(async () => {
    if (mutatingVisibility) return;
    setMutatingVisibility(true);
    try {
      const data = await callVisibility("publish");
      setVisibility(data.visibility ?? "public");
      setPublicSlug(data.publicSlug ?? null);
      toast.success("Public link is live.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't publish the campaign."
      );
    } finally {
      setMutatingVisibility(false);
    }
  }, [callVisibility, mutatingVisibility]);

  const handleUnpublish = useCallback(async () => {
    if (mutatingVisibility) return;
    setMutatingVisibility(true);
    try {
      const data = await callVisibility("unpublish");
      setVisibility(data.visibility ?? "private");
      setPublicSlug(data.publicSlug ?? null);
      toast.success("Campaign is private. The previous link is dead.");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Couldn't make the campaign private."
      );
    } finally {
      setMutatingVisibility(false);
    }
  }, [callVisibility, mutatingVisibility]);

  const handleRegenerate = useCallback(async () => {
    if (mutatingVisibility) return;
    setMutatingVisibility(true);
    try {
      const data = await callVisibility("regenerate");
      setVisibility(data.visibility ?? "public");
      setPublicSlug(data.publicSlug ?? null);
      // Auto-copy the new URL — visitors won't have time to grab the old one.
      const next =
        data.url ??
        (data.publicSlug && typeof window !== "undefined"
          ? `${window.location.origin}/c/${brandSlug}/${data.publicSlug}`
          : null);
      if (next) {
        try {
          await navigator.clipboard.writeText(next);
        } catch {
          // Clipboard write can fail silently in non-secure contexts; the URL
          // still surfaces in the read-only field below the buttons.
        }
      }
      toast.success("Old link is now dead. New link copied.");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Couldn't regenerate the link."
      );
    } finally {
      setMutatingVisibility(false);
    }
  }, [brandSlug, callVisibility, mutatingVisibility]);

  const handleCopy = useCallback(async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy the link. Try selecting it manually.");
    }
  }, [publicUrl]);

  const handleToggle = useCallback(
    (next: boolean) => {
      if (next) {
        void handlePublish();
      } else {
        void handleUnpublish();
      }
    },
    [handlePublish, handleUnpublish]
  );

  const refetch = useCallback(async () => {
    setItems(null);
    try {
      const res = await fetch(
        `/api/library?campaign=${campaign.id}&limit=200`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        toast.error("Couldn't load campaign assets.");
        setItems([]);
        return;
      }
      const data = (await res.json()) as { items: Asset[] };
      setItems(data.items);
    } catch {
      toast.error("Couldn't load campaign assets.");
      setItems([]);
    }
  }, [campaign.id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const handleBulkAdd = useCallback(
    async (assetIds: string[]) => {
      try {
        const res = await fetch(`/api/campaigns/${campaign.id}/assets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetIds }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(
            data.error === "asset_brand_mismatch"
              ? "Some assets aren't on this brand and were skipped."
              : "Couldn't add assets. Try again."
          );
          return;
        }
        const data = (await res.json()) as {
          requested: number;
          inserted: number;
          skipped: number;
        };
        if (data.inserted === 0) {
          toast.success("Already on the campaign — nothing new to add.");
        } else if (data.skipped > 0) {
          toast.success(
            `Added ${data.inserted} asset${
              data.inserted === 1 ? "" : "s"
            } (${data.skipped} already on the campaign).`
          );
        } else {
          toast.success(
            `Added ${data.inserted} asset${data.inserted === 1 ? "" : "s"}.`
          );
        }
        setPickerOpen(false);
        refetch();
      } catch {
        toast.error("Couldn't add assets. Try again.");
      }
    },
    [campaign.id, refetch]
  );

  const dateRange = formatDateRange(campaign.startsAt, campaign.endsAt);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Link
              href={`/brands/${brandSlug}/campaigns`}
              className="hover:text-foreground"
            >
              {brandName} campaigns
            </Link>
          </div>
          <h2 className="font-heading text-xl font-semibold">
            <span className="inline-flex items-center gap-2">
              <Megaphone
                className="size-5 text-primary"
                strokeWidth={1.5}
                aria-hidden
              />
              {campaign.name}
            </span>
          </h2>
          {campaign.description && (
            <p className="text-sm text-muted-foreground">
              {campaign.description}
            </p>
          )}
          {dateRange && (
            <p className="text-xs text-muted-foreground">{dateRange}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            href={`/generate?campaign=${campaign.id}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Wand2 aria-hidden />
            Generate for campaign
          </Link>
          <Button size="sm" onClick={() => setPickerOpen(true)}>
            <Plus aria-hidden />
            Add assets
          </Button>
        </div>
      </header>

      <CampaignVisibilitySection
        visibility={visibility}
        publicUrl={publicUrl}
        publicSharingAvailable={publicSharingAvailable}
        canManageCampaign={canManageCampaign}
        mutating={mutatingVisibility}
        copied={copied}
        onToggle={handleToggle}
        onCopy={handleCopy}
        onRegenerate={handleRegenerate}
        onUnpublish={handleUnpublish}
      />

      <section>
        <h3 className="sr-only">Campaign assets</h3>
        {items === null ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <CampaignEmptyState
            campaignName={campaign.name}
            onAdd={() => setPickerOpen(true)}
            generateHref={`/generate?campaign=${campaign.id}`}
          />
        ) : (
          <ul
            data-slot="campaign-grid"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
          >
            {items.map((a) => (
              <li key={a.id}>
                <CampaignAssetCard asset={a} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <LibraryAssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onConfirm={handleBulkAdd}
        brandId={brandId}
        title={`Add to ${campaign.name}`}
        description={`Pick assets from ${brandName} to attach to this campaign.`}
        confirmLabel="Add to campaign"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CampaignVisibilitySection — the Public/Private toggle, the read-only URL
// field, and the Regenerate / Make Private affordances. Renders inert with a
// tooltip when `R2_PUBLIC_URL` is unset on the server (D14 / FR-017),
// EXCEPT for the case where a previously-public campaign exists — operators
// can always revoke prior links via Make Private regardless of the env var.
// ---------------------------------------------------------------------------

interface CampaignVisibilitySectionProps {
  visibility: "private" | "public";
  publicUrl: string | null;
  publicSharingAvailable: boolean;
  canManageCampaign: boolean;
  mutating: boolean;
  copied: boolean;
  onToggle: (next: boolean) => void;
  onCopy: () => void;
  onRegenerate: () => void;
  onUnpublish: () => void;
}

function CampaignVisibilitySection({
  visibility,
  publicUrl,
  publicSharingAvailable,
  canManageCampaign,
  mutating,
  copied,
  onToggle,
  onCopy,
  onRegenerate,
  onUnpublish,
}: CampaignVisibilitySectionProps) {
  const isPublic = visibility === "public";
  // Toggle is disabled when sharing isn't configured AND the campaign is
  // currently private — there's nothing publishable. If the campaign is
  // already public from a prior deploy, leave Make Private wired up.
  const toggleDisabled =
    !canManageCampaign ||
    mutating ||
    (!publicSharingAvailable && !isPublic);

  const switchEl = (
    <Switch
      checked={isPublic}
      onCheckedChange={onToggle}
      disabled={toggleDisabled}
      aria-label={isPublic ? "Make campaign private" : "Publish campaign"}
    />
  );

  return (
    <section
      data-slot="campaign-visibility"
      className={cn(
        "flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10",
        "sm:flex-row sm:items-start sm:justify-between"
      )}
    >
      <div className="min-w-0 space-y-1">
        <h3 className="font-heading text-base font-semibold">
          <span className="inline-flex items-center gap-2">
            {isPublic ? (
              <Megaphone
                className="size-4 text-primary"
                strokeWidth={1.5}
                aria-hidden
              />
            ) : (
              <Lock
                className="size-4 text-muted-foreground"
                strokeWidth={1.5}
                aria-hidden
              />
            )}
            Visibility
          </span>
        </h3>
        <p className="text-sm text-muted-foreground">
          {isPublic
            ? "Anyone with the link can view this campaign's approved assets."
            : "Only workspace members can view this campaign."}
        </p>
        {!publicSharingAvailable && !isPublic && (
          <p className="text-xs text-muted-foreground">
            Public sharing requires <code className="font-mono">R2_PUBLIC_URL</code>.
            Ask your administrator to configure it.
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-xs font-medium uppercase tracking-wider",
              isPublic ? "text-muted-foreground" : "text-foreground"
            )}
          >
            Private
          </span>
          {!publicSharingAvailable && !isPublic ? (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                {switchEl}
              </TooltipTrigger>
              <TooltipContent>
                Public sharing requires R2_PUBLIC_URL. Ask your administrator
                to configure it.
              </TooltipContent>
            </Tooltip>
          ) : (
            switchEl
          )}
          <span
            className={cn(
              "text-xs font-medium uppercase tracking-wider",
              isPublic ? "text-foreground" : "text-muted-foreground"
            )}
          >
            Public
          </span>
        </div>

        {isPublic && (
          <div className="w-full max-w-md space-y-2 sm:w-[420px]">
            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 ring-1 ring-foreground/10">
              <input
                type="text"
                readOnly
                value={publicUrl ?? "Generating link…"}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 truncate bg-transparent font-mono text-xs text-foreground outline-none"
                aria-label="Public campaign URL"
              />
              <Button
                size="xs"
                variant="ghost"
                onClick={onCopy}
                disabled={!publicUrl}
                aria-label="Copy public URL"
              >
                {copied ? (
                  <>
                    <Check aria-hidden />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy aria-hidden />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Renaming the campaign won&apos;t change this URL — click
              Regenerate to mint a new one.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={onRegenerate}
                disabled={
                  !canManageCampaign || mutating || !publicSharingAvailable
                }
              >
                <RefreshCw aria-hidden />
                Regenerate
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onUnpublish}
                disabled={!canManageCampaign || mutating}
              >
                <Lock aria-hidden />
                Make private
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CampaignAssetCard — read-only thumbnail tile. Clicking opens the asset in
// the workspace Library so the user lands in the existing detail panel.
// ---------------------------------------------------------------------------

function CampaignAssetCard({ asset }: { asset: Asset }) {
  return (
    <Link
      href={`/library?asset=${asset.id}`}
      data-slot="campaign-asset-card"
      className={cn(
        "group/card relative block overflow-hidden rounded-xl bg-muted text-left",
        "ring-1 ring-foreground/10",
        "hover:-translate-y-0.5 hover:shadow-lg hover:ring-primary/40",
        "active:translate-y-px",
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
      )}
      aria-label={asset.fileName ?? `Asset ${asset.id.slice(0, 8)}`}
    >
      <div className="relative aspect-square">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.thumbnailUrl}
          alt={asset.fileName ?? "Campaign asset"}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/75 via-black/20 to-transparent p-3 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100 group-focus-visible/card:opacity-100">
          {asset.fileName && (
            <p className="line-clamp-1 text-xs font-medium text-white/95">
              <Hash className="mr-1 inline size-3 align-[-2px]" aria-hidden />
              {asset.fileName}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Empty state — encourage tagging existing assets or generating fresh.
// ---------------------------------------------------------------------------

function CampaignEmptyState({
  campaignName,
  onAdd,
  generateHref,
}: {
  campaignName: string;
  onAdd: () => void;
  generateHref: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-card px-6 py-16 text-center ring-1 ring-foreground/10">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Megaphone className="size-6" strokeWidth={1.5} aria-hidden />
      </div>
      <h3 className="font-heading text-lg font-semibold">
        Nothing tagged yet
      </h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Add existing brand assets to {campaignName}, or generate something
        fresh — we&apos;ll pre-tag it for you.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={onAdd}>
          <Plus aria-hidden />
          Add assets
        </Button>
        <Link href={generateHref} className={buttonVariants({ variant: "outline" })}>
          <Wand2 aria-hidden />
          Generate for campaign
        </Link>
      </div>
    </div>
  );
}

function formatDateRange(
  startsAt: string | null,
  endsAt: string | null
): string | null {
  if (!startsAt && !endsAt) return null;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  if (startsAt && endsAt) return `${fmt(startsAt)} – ${fmt(endsAt)}`;
  if (startsAt) return `Starts ${fmt(startsAt)}`;
  return `Ends ${fmt(endsAt!)}`;
}
