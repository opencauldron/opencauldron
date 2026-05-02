/**
 * POST /api/campaigns/[id]/assets — bulk-attach assets to a campaign.
 *
 * Body: `{ assetIds: string[] }` (uuids, max 200 per request).
 *
 * Permission: brand_member+ on the campaign's brand. Validates that every
 * asset belongs to that same brand — campaigns are brand-locked, so cross-
 * brand attaches are rejected wholesale rather than partially applied.
 *
 * Idempotent — duplicate `(asset_id, campaign_id)` rows are silently
 * skipped via `ON CONFLICT DO NOTHING`. Returns the number of rows actually
 * inserted so the caller can show "added N of M" toasts.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets, assetCampaigns, campaigns } from "@/lib/db/schema";
import {
  isBrandMember,
  loadBrandContext,
  loadRoleContext,
} from "@/lib/workspace/permissions";

const bodySchema = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(200),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: campaignId } = await params;

  // Resolve the campaign + brand for permission gating.
  const [campaign] = await db
    .select({ id: campaigns.id, brandId: campaigns.brandId })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const brandCtx = await loadBrandContext(campaign.brandId);
  if (!brandCtx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const ctx = await loadRoleContext(userId, brandCtx.workspaceId);
  // Brand membership is enough — anyone who can see the brand's gallery can
  // tag its assets into a campaign. (Creating campaigns is brand_manager+;
  // tagging is intentionally lower-friction.)
  if (!isBrandMember(ctx, campaign.brandId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const requestedIds = Array.from(new Set(parsed.data.assetIds));

  // Validate every asset belongs to the campaign's brand. We don't want a
  // mistyped (or malicious) id to silently leak into someone else's campaign,
  // and we'd rather fail loudly than partially apply.
  const validRows = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        inArray(assets.id, requestedIds),
        eq(assets.brandId, campaign.brandId)
      )
    );
  const validIds = validRows.map((r) => r.id);
  if (validIds.length !== requestedIds.length) {
    const valid = new Set(validIds);
    const invalid = requestedIds.filter((id) => !valid.has(id));
    return NextResponse.json(
      {
        error: "asset_brand_mismatch",
        invalidIds: invalid,
      },
      { status: 400 }
    );
  }

  // Bulk insert with ON CONFLICT DO NOTHING — composite PK forbids dupes,
  // and we don't want a re-attach to error.
  const inserted = await db
    .insert(assetCampaigns)
    .values(
      validIds.map((assetId) => ({
        assetId,
        campaignId,
      }))
    )
    .onConflictDoNothing()
    .returning({ assetId: assetCampaigns.assetId });

  return NextResponse.json({
    requested: requestedIds.length,
    inserted: inserted.length,
    skipped: requestedIds.length - inserted.length,
  });
}
