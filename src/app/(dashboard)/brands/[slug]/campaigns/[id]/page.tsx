/**
 * /brands/[slug]/campaigns/[id] — campaign detail page.
 *
 * Header: campaign name + description + dates + two CTAs:
 *   1. "Generate for campaign" — links to /generate?campaign=<id>
 *   2. "Add assets" — opens the existing library asset picker dialog,
 *      filtered to this brand, and bulk-attaches selected assets.
 *
 * Body: a simple grid of campaign-tagged assets, fetched live from
 * `/api/library?campaign=<id>` (the filter already exists in the API). The
 * page mirrors the brand layout style — sits inside the brand shell so the
 * tab nav stays visible.
 */

import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brands, campaigns } from "@/lib/db/schema";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import {
  isBrandManager,
  isBrandMember,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { isPublicSharingAvailable } from "@/lib/public/r2-availability";
import { CampaignDetailClient } from "./campaign-detail-client";

interface Props {
  params: Promise<{ slug: string; id: string }>;
}

export default async function CampaignDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  const ws = await getCurrentWorkspace(session.user.id);
  if (!ws) notFound();

  const { slug, id } = await params;

  // Resolve the brand by slug (mirrors the parent campaigns/page.tsx).
  const [brand] =
    slug === "personal"
      ? await db
          .select({
            id: brands.id,
            name: brands.name,
            isPersonal: brands.isPersonal,
          })
          .from(brands)
          .where(
            and(
              eq(brands.workspaceId, ws.id),
              eq(brands.isPersonal, true),
              eq(brands.ownerId, session.user.id)
            )
          )
          .limit(1)
      : await db
          .select({
            id: brands.id,
            name: brands.name,
            isPersonal: brands.isPersonal,
          })
          .from(brands)
          .where(
            and(eq(brands.workspaceId, ws.id), eq(brands.slug, slug))
          )
          .limit(1);

  if (!brand) notFound();
  if (brand.isPersonal) {
    return (
      <div className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
        Personal brands don&apos;t support campaigns.
      </div>
    );
  }

  const [campaign] = await db
    .select({
      id: campaigns.id,
      brandId: campaigns.brandId,
      name: campaigns.name,
      description: campaigns.description,
      startsAt: campaigns.startsAt,
      endsAt: campaigns.endsAt,
      createdAt: campaigns.createdAt,
      visibility: campaigns.visibility,
      publicSlug: campaigns.publicSlug,
    })
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.brandId, brand.id)))
    .limit(1);
  if (!campaign) notFound();

  const ctx = await loadRoleContext(session.user.id, ws.id);
  if (!isBrandMember(ctx, brand.id)) notFound();

  // T014 / FR-017 — surface whether the visibility toggle should be enabled
  // and whether the caller can mutate it. `canManageCampaigns` here is
  // `brand_manager+` on the campaign's brand, matching the gate enforced by
  // POST /api/campaigns/[id]/visibility.
  const publicSharingAvailable = isPublicSharingAvailable();
  const canManageCampaign = isBrandManager(ctx, brand.id);

  return (
    <CampaignDetailClient
      brandId={brand.id}
      brandName={brand.name}
      brandSlug={slug}
      campaign={{
        id: campaign.id,
        name: campaign.name,
        description: campaign.description,
        startsAt: campaign.startsAt
          ? campaign.startsAt.toISOString()
          : null,
        endsAt: campaign.endsAt ? campaign.endsAt.toISOString() : null,
        visibility: campaign.visibility,
        publicSlug: campaign.publicSlug,
      }}
      publicSharingAvailable={publicSharingAvailable}
      canManageCampaign={canManageCampaign}
    />
  );
}
