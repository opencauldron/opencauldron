/**
 * Public campaign gallery (T010).
 *
 * Unauthenticated route at `/c/[brandSlug]/[campaignPublicSlug]`. Renders a
 * stripped-down read-only grid of every `status='approved'` asset attached
 * to a campaign with `visibility='public'`.
 *
 * Spec refs: FR-003..FR-009, FR-013, FR-014, FR-016 (`specs/public-campaign-galleries/spec.md`).
 * Plan refs: D1, D2, D3, D4, D8, D10, D11, D13 (`specs/public-campaign-galleries/plan.md`).
 *
 * Defense in depth (D10):
 *   - `<meta name="robots" content="noindex, nofollow">` via `generateMetadata.robots`.
 *   - `X-Robots-Tag` and `Cache-Control` set in `next.config.ts` `headers()` block (T015).
 *
 * Rate limit (T020): per-IP token bucket via `checkAndConsumeIpRateLimit`. On block
 * we render a friendly screen with `Retry-After` in plain copy — RSCs can't return
 * arbitrary status codes, so we render HTML rather than throwing.
 *
 * No `auth()` call by design (FR-013). The route lives outside the `(dashboard)`
 * group; the only privacy gate is `visibility='public'` on the campaign row.
 */

import { cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { brands, campaigns, assets, assetCampaigns, users } from "@/lib/db/schema";
import { getAssetUrl } from "@/lib/storage";
import { checkAndConsumeIpRateLimit } from "@/lib/public/rate-limit";

import { PublicGalleryClient } from "./public-gallery-client";
import { RateLimitedView } from "./rate-limited-view";

type PageParams = Promise<{ brandSlug: string; campaignPublicSlug: string }>;

const ASSET_LIMIT = 200;

// React `cache()` dedupes the lookup between `generateMetadata` and the page
// handler so we only hit the DB once per request.
const loadCampaign = cache(async (publicSlug: string) => {
  const [row] = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      visibility: campaigns.visibility,
      publicSlug: campaigns.publicSlug,
      brandSlug: brands.slug,
      brandName: brands.name,
    })
    .from(campaigns)
    .innerJoin(brands, eq(brands.id, campaigns.brandId))
    .where(eq(campaigns.publicSlug, publicSlug))
    .limit(1);

  return row ?? null;
});

async function loadApprovedAssets(campaignId: string) {
  return db
    .select({
      id: assets.id,
      r2Url: assets.r2Url,
      r2Key: assets.r2Key,
      webpR2Key: assets.webpR2Key,
      webpStatus: assets.webpStatus,
      fileName: assets.fileName,
      width: assets.width,
      height: assets.height,
      mediaType: assets.mediaType,
      creatorName: users.name,
      createdAt: assets.createdAt,
    })
    .from(assetCampaigns)
    .innerJoin(assets, eq(assets.id, assetCampaigns.assetId))
    .innerJoin(users, eq(users.id, assets.userId))
    .where(
      and(
        eq(assetCampaigns.campaignId, campaignId),
        eq(assets.status, "approved")
      )
    )
    .orderBy(desc(assets.createdAt))
    .limit(ASSET_LIMIT);
}

function clientIp(headerValue: string | null): string {
  if (!headerValue) return "unknown";
  return headerValue.split(",")[0]?.trim() || "unknown";
}

export async function generateMetadata({
  params,
}: {
  params: PageParams;
}): Promise<Metadata> {
  // Title is a soft signal — even if the campaign isn't found / isn't public
  // we still emit `noindex` so a stray crawler picking the URL up off a leak
  // doesn't index it. Defense in depth alongside the X-Robots-Tag header.
  const { campaignPublicSlug } = await params;

  const campaign = await loadCampaign(campaignPublicSlug).catch(() => null);

  const title = campaign
    ? `${campaign.name} · ${campaign.brandName}`
    : "Campaign · OpenCauldron";

  return {
    title,
    robots: { index: false, follow: false },
  };
}

export default async function Page({ params }: { params: PageParams }) {
  const { brandSlug: requestedBrandSlug, campaignPublicSlug } = await params;

  // T020 — per-IP rate limit. RSCs can't emit a 429 status; render a styled
  // "too many requests" page with the retry seconds visible.
  const headerList = await headers();
  const ip = clientIp(headerList.get("x-forwarded-for"));
  const limit = checkAndConsumeIpRateLimit(ip);
  if (!limit.ok) {
    const retryAfterSeconds = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
    return <RateLimitedView retryAfterSeconds={retryAfterSeconds} />;
  }

  const campaign = await loadCampaign(campaignPublicSlug);

  if (!campaign || campaign.visibility !== "public" || !campaign.publicSlug) {
    notFound();
  }

  // Canonical redirect (D4 / FR-004). `brandSlug` segment is cosmetic — the
  // campaign was resolved by globally-unique `public_slug` alone — but if the
  // URL's brand slug doesn't match the campaign's actual brand, redirect to
  // the canonical path so search/UX never sees the mismatch (308; see DI-001).
  if (
    campaign.brandSlug &&
    requestedBrandSlug !== campaign.brandSlug
  ) {
    permanentRedirect(`/c/${campaign.brandSlug}/${campaign.publicSlug}`);
  }

  const rows = await loadApprovedAssets(campaign.id);

  // Resolve the display URL per asset (A5 / D1):
  //   - prefer the WebP variant via `getAssetUrl(webpR2Key)` when ready
  //   - else fall back to `r2Url` (already a public URL when R2_PUBLIC_URL is set)
  // `getAssetUrl` is async because the local backend may need to do work; in
  // the R2-public-URL case it's a string concat, but await it for correctness.
  const galleryAssets = await Promise.all(
    rows.map(async (row) => {
      const useWebp =
        row.webpStatus === "ready" && !!row.webpR2Key && row.mediaType !== "video";
      const url = useWebp
        ? await getAssetUrl(row.webpR2Key as string)
        : row.r2Url;
      return {
        id: row.id,
        url,
        fileName: row.fileName,
        width: row.width,
        height: row.height,
        mediaType: row.mediaType,
        creatorName: row.creatorName,
      };
    })
  );

  return (
    <PublicGalleryClient
      campaign={{ name: campaign.name }}
      brand={{ name: campaign.brandName }}
      assets={galleryAssets}
    />
  );
}
