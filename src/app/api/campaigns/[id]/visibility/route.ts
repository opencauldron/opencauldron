/**
 * POST /api/campaigns/[id]/visibility
 *
 * Toggle a campaign between private and public, regenerate its public link, or
 * revoke a previously-published link. Backs the Visibility section on the
 * dashboard campaign detail page (T014) and gates the public gallery route at
 * /c/[brandSlug]/[campaignPublicSlug].
 *
 * Body shape: { action: 'publish' | 'unpublish' | 'regenerate' }
 *
 * Auth: requires a session AND `brand_manager+` on the campaign's brand —
 * same gate as PATCH/DELETE on /api/campaigns/[id] (FR-010).
 *
 * Self-host gate (FR-017 / D14): when `R2_PUBLIC_URL` is unset,
 * `publish` and `regenerate` return 412 PRECONDITION_FAILED with machine code
 * `r2_public_url_unset`. `unpublish` is intentionally allowed without
 * `R2_PUBLIC_URL` so operators can revoke prior public links after losing the
 * env var.
 *
 * Cache: every successful mutation calls
 * `revalidatePath('/c/[brandSlug]/[campaignPublicSlug]', 'page')` — per
 * DI-003 a single pattern call invalidates ALL matching paths, so old and
 * new slugs are both refreshed in one shot.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brands, campaigns } from "@/lib/db/schema";
import {
  isBrandManager,
  loadBrandContext,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { isPublicSharingAvailable } from "@/lib/public/r2-availability";
import {
  generatePublicCampaignSlug,
  regeneratePublicCampaignSlug,
} from "@/lib/public/slug";

const bodySchema = z.object({
  action: z.enum(["publish", "unpublish", "regenerate"]),
});

const SLUG_RETRY_ATTEMPTS = 3;
const PUBLIC_PATH_PATTERN = "/c/[brandSlug]/[campaignPublicSlug]";

function buildPublicUrl(
  origin: string,
  brandSlug: string | null,
  publicSlug: string
): string | null {
  if (!brandSlug) return null;
  return `${origin}/c/${brandSlug}/${publicSlug}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { action } = parsed.data;

  // Self-host gate — D14 / FR-017. unpublish is allowed even when unset.
  if (action !== "unpublish" && !isPublicSharingAvailable()) {
    return NextResponse.json(
      {
        error: "r2_public_url_unset",
        message:
          "Public sharing requires R2_PUBLIC_URL to be configured.",
      },
      { status: 412 }
    );
  }

  // Resolve campaign + brand for the permission gate.
  const [campaign] = await db
    .select({
      id: campaigns.id,
      brandId: campaigns.brandId,
      name: campaigns.name,
      visibility: campaigns.visibility,
      publicSlug: campaigns.publicSlug,
    })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const brandCtx = await loadBrandContext(campaign.brandId);
  if (!brandCtx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Defensive A3 / Risk row 9 check — personal brands can't have campaigns,
  // but if we ever get here, refuse loudly rather than mint a public URL.
  if (brandCtx.isPersonal) {
    return NextResponse.json(
      { error: "personal_brand_not_publishable" },
      { status: 400 }
    );
  }

  const ctx = await loadRoleContext(session.user.id, brandCtx.workspaceId);
  if (!isBrandManager(ctx, campaign.brandId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Pull the canonical brand slug for response URL formatting.
  const [brandRow] = await db
    .select({ slug: brands.slug })
    .from(brands)
    .where(eq(brands.id, campaign.brandId))
    .limit(1);

  const origin = req.nextUrl.origin;

  // -------------------------------------------------------------------------
  // Action: publish
  // -------------------------------------------------------------------------
  if (action === "publish") {
    if (campaign.visibility === "public" && campaign.publicSlug) {
      return NextResponse.json({
        visibility: "public" as const,
        publicSlug: campaign.publicSlug,
        url: buildPublicUrl(origin, brandRow?.slug ?? null, campaign.publicSlug),
      });
    }

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < SLUG_RETRY_ATTEMPTS; attempt++) {
      const candidate = generatePublicCampaignSlug(campaign.name);
      try {
        const [updated] = await db
          .update(campaigns)
          .set({ visibility: "public", publicSlug: candidate })
          .where(eq(campaigns.id, campaign.id))
          .returning({
            visibility: campaigns.visibility,
            publicSlug: campaigns.publicSlug,
          });
        revalidatePath(PUBLIC_PATH_PATTERN, "page");
        return NextResponse.json({
          visibility: "public" as const,
          publicSlug: updated.publicSlug,
          url: buildPublicUrl(
            origin,
            brandRow?.slug ?? null,
            updated.publicSlug ?? candidate
          ),
        });
      } catch (err) {
        if (err instanceof Error && /unique/i.test(err.message)) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    return NextResponse.json(
      { error: "slug_collision", message: String(lastErr) },
      { status: 500 }
    );
  }

  // -------------------------------------------------------------------------
  // Action: unpublish
  // -------------------------------------------------------------------------
  if (action === "unpublish") {
    await db
      .update(campaigns)
      .set({ visibility: "private", publicSlug: null })
      .where(eq(campaigns.id, campaign.id));
    revalidatePath(PUBLIC_PATH_PATTERN, "page");
    return NextResponse.json({
      visibility: "private" as const,
      publicSlug: null,
      url: null,
    });
  }

  // -------------------------------------------------------------------------
  // Action: regenerate
  // -------------------------------------------------------------------------
  if (campaign.visibility !== "public") {
    return NextResponse.json({ error: "not_public" }, { status: 409 });
  }

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < SLUG_RETRY_ATTEMPTS; attempt++) {
    const candidate = regeneratePublicCampaignSlug(campaign.name);
    try {
      const [updated] = await db
        .update(campaigns)
        .set({ publicSlug: candidate })
        .where(eq(campaigns.id, campaign.id))
        .returning({
          visibility: campaigns.visibility,
          publicSlug: campaigns.publicSlug,
        });
      revalidatePath(PUBLIC_PATH_PATTERN, "page");
      return NextResponse.json({
        visibility: "public" as const,
        publicSlug: updated.publicSlug,
        url: buildPublicUrl(
          origin,
          brandRow?.slug ?? null,
          updated.publicSlug ?? candidate
        ),
      });
    } catch (err) {
      if (err instanceof Error && /unique/i.test(err.message)) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  return NextResponse.json(
    { error: "slug_collision", message: String(lastErr) },
    { status: 500 }
  );
}
