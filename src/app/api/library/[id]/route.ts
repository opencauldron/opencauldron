/**
 * /api/library/[id] — single Library asset operations (US1 / T012-T014).
 *
 * GET    — detail view. Same item shape as the list endpoint.
 * PATCH  — edit `tags` (M2M replace), `campaigns` (M2M replace), `fileName`
 *          (column update), `pinnedToBrand` (toggle membership in
 *          `brands.anchor_asset_ids` JSONB).
 * DELETE — remove the asset row, R2 blob, thumbnail, AND scrub the asset id
 *          from any brand's `anchor_asset_ids` JSONB (we don't have an FK
 *          enforcing referential integrity over JSONB).
 *
 * All operations require the asset belong to the authenticated user. Mirrors
 * the auth pattern of `/api/references/[id]` so the compat shim is a thin
 * pass-through.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  assets,
  assetCampaigns,
  assetTags,
  brands,
  campaigns as campaignsTbl,
} from "@/lib/db/schema";
import { deleteFile } from "@/lib/storage";
import { env } from "@/lib/env";
import {
  canEditBrandKit,
  loadBrandContext,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { loadOwnedLibraryItem } from "../lib";

function flagOff(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

// ---------------------------------------------------------------------------
// GET — detail
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!env.LIBRARY_DAM_ENABLED) return flagOff();

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const item = await loadOwnedLibraryItem(id, session.user.id);
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ item });
}

// ---------------------------------------------------------------------------
// PATCH — edit tags / campaigns / fileName / brand-anchor toggle
// ---------------------------------------------------------------------------

const patchSchema = z
  .object({
    tags: z.array(z.string().min(1).max(100)).max(64).optional(),
    campaigns: z.array(z.string().uuid()).max(32).optional(),
    fileName: z.string().min(1).max(512).nullable().optional(),
    pinnedToBrand: z
      .object({
        brandId: z.string().uuid(),
        pinned: z.boolean(),
      })
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!env.LIBRARY_DAM_ENABLED) return flagOff();

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const { id } = await params;

  // Auth + existence: same query, single round-trip.
  const [existing] = await db
    .select({ id: assets.id, userId: assets.userId })
    .from(assets)
    .where(eq(assets.id, id))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.userId !== userId) {
    // Don't leak existence cross-user — 404 mirrors the references behavior.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { tags, campaigns, fileName, pinnedToBrand } = parsed.data;

  // 1. tags — full replace. M2M is `(assetId, tag)` text strings, no Tag table.
  if (tags !== undefined) {
    await db.delete(assetTags).where(eq(assetTags.assetId, id));
    if (tags.length > 0) {
      // Dedupe — composite PK forbids dupes and a single payload typo would
      // otherwise tank the entire patch.
      const unique = Array.from(new Set(tags));
      await db
        .insert(assetTags)
        .values(unique.map((tag) => ({ assetId: id, tag })));
    }
  }

  // 2. campaigns — full replace. Validate every id belongs to a campaign the
  // user can plausibly tag (we scope by campaigns linked to brands the user
  // owns or is a member of, but the simpler v1 check is "the campaign exists"
  // — campaign visibility is already brand-scoped at the API layer).
  if (campaigns !== undefined) {
    if (campaigns.length > 0) {
      const validCampaigns = await db
        .select({ id: campaignsTbl.id })
        .from(campaignsTbl)
        .where(inArray(campaignsTbl.id, campaigns));
      if (validCampaigns.length !== campaigns.length) {
        return NextResponse.json(
          { error: "invalid_campaign_id" },
          { status: 400 }
        );
      }
    }
    await db.delete(assetCampaigns).where(eq(assetCampaigns.assetId, id));
    if (campaigns.length > 0) {
      await db
        .insert(assetCampaigns)
        .values(
          Array.from(new Set(campaigns)).map((campaignId) => ({
            assetId: id,
            campaignId,
          }))
        );
    }
  }

  // 3. fileName — direct column update. `null` clears it.
  if (fileName !== undefined) {
    await db
      .update(assets)
      .set({ fileName, updatedAt: new Date() })
      .where(eq(assets.id, id));
  }

  // 4. pinnedToBrand — toggle membership in brands.anchor_asset_ids JSONB.
  // Validate the user owns / can edit the target brand. Owners of a Personal
  // brand or workspace admins of the brand's workspace are the supported
  // cases; we reuse the same `loadBrandContext` + `loadRoleContext` pair as
  // the brand-kit editor (`/api/brands/[id]` PATCH) for consistency.
  if (pinnedToBrand) {
    const { brandId, pinned } = pinnedToBrand;

    const brandCtx = await loadBrandContext(brandId);
    if (!brandCtx) {
      return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
    }
    const ctx = await loadRoleContext(userId, brandCtx.workspaceId);
    if (!canEditBrandKit(ctx, brandCtx)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Atomic JSONB rewrite — read the current array, dedupe, write back. A
    // CAS-style concurrent edit could race; the brand kit UI is single-user
    // and the dedupe makes a duplicate-write a no-op, so we accept the
    // simpler shape over a row-lock dance.
    const [brand] = await db
      .select({ anchorAssetIds: brands.anchorAssetIds })
      .from(brands)
      .where(eq(brands.id, brandId))
      .limit(1);
    if (!brand) {
      return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
    }
    const current = brand.anchorAssetIds ?? [];
    const next = pinned
      ? Array.from(new Set([...current, id]))
      : current.filter((x) => x !== id);
    if (next.length !== current.length || pinned) {
      await db
        .update(brands)
        .set({ anchorAssetIds: next })
        .where(eq(brands.id, brandId));
    }
  }

  // Return the freshly-hydrated item so the client doesn't need a follow-up GET.
  const item = await loadOwnedLibraryItem(id, userId);
  return NextResponse.json({ item });
}

// ---------------------------------------------------------------------------
// DELETE — remove asset, blob, thumbnail, and scrub any brand-anchor pointers.
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!env.LIBRARY_DAM_ENABLED) return flagOff();

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [asset] = await db
    .select({
      id: assets.id,
      userId: assets.userId,
      r2Key: assets.r2Key,
      thumbnailR2Key: assets.thumbnailR2Key,
      webpR2Key: assets.webpR2Key,
    })
    .from(assets)
    .where(and(eq(assets.id, id), eq(assets.userId, session.user.id)))
    .limit(1);

  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Scrub the asset id from any brand's anchor_asset_ids JSONB array. The
  // column has no FK to assets — Phase 2's plan called this out — so deletes
  // would otherwise leave dangling pointers visible in the brand-kit UI.
  // `jsonb_path_query_array` filters the array element-wise; cheaper than
  // round-tripping every brand row through Node.
  await db.execute(sql`
    UPDATE "brands"
    SET "anchor_asset_ids" = COALESCE(
      (
        SELECT jsonb_agg(elem)
        FROM jsonb_array_elements_text("anchor_asset_ids") AS elem
        WHERE elem <> ${id}
      ),
      '[]'::jsonb
    )
    WHERE "anchor_asset_ids" @> ${JSON.stringify([id])}::jsonb
  `);

  // Storage cleanup. Best-effort — orphan R2 objects are recoverable, a
  // failed delete blocking the row would not be.
  try {
    await deleteFile(asset.r2Key);
    if (asset.thumbnailR2Key) {
      await deleteFile(asset.thumbnailR2Key);
    }
    if (asset.webpR2Key) {
      await deleteFile(asset.webpR2Key);
    }
  } catch (error) {
    console.error("Failed to delete library asset from storage:", error);
  }

  // Cascading FK on asset_tags / asset_campaigns / uploads / asset_review_log
  // handles the rest.
  await db.delete(assets).where(eq(assets.id, id));

  return NextResponse.json({ success: true });
}
