"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Hash, Megaphone, Plus, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  };
}

export function CampaignDetailClient({
  brandId,
  brandName,
  brandSlug,
  campaign,
}: CampaignDetailClientProps) {
  const [items, setItems] = useState<Asset[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

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
