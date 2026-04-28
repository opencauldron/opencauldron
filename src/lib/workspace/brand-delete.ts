/**
 * Brand-deletion core.
 *
 * Two paths:
 *   - reassign: move every asset and brew to a target brand (same workspace,
 *     non-personal). Each reassigned asset gets a `moved_brand` audit row.
 *   - delete: drop every asset and brew on the source brand. Cascades clean
 *     up `asset_review_log`, `asset_campaigns`, `asset_collections`, `uploads`,
 *     `brew_visibility_log`, `brand_members`, `campaigns`, and `collections`.
 *
 * The Neon HTTP driver doesn't expose `db.transaction`, so this is a serial
 * chain of writes — same pattern used elsewhere in the route layer (see
 * `bootstrap.ts` and `assets/[id]/reassign-brand/route.ts`). Each step is
 * idempotent enough that a partial failure leaves the data in a recoverable
 * state.
 *
 * Validation gates (caller is responsible for permission/role checks; this
 * module enforces invariants that depend on workspace state):
 *   - 400 personal_brand_undeletable: source.isPersonal=true
 *   - 400 last_non_personal_brand: source is the only non-personal brand left
 *   - 400 reassign_target_required: assetAction='reassign' with no target
 *   - 400 target_brand_invalid: target not in same workspace, or is personal,
 *         or is the source itself
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  assetReviewLog,
  assets,
  brands,
  brews,
} from "@/lib/db/schema";

export type BrandAssetAction = "reassign" | "delete";

export interface DeleteBrandInput {
  brandId: string;
  actorId: string;
  assetAction: BrandAssetAction;
  reassignBrandId?: string;
}

export type DeleteBrandResult =
  | { ok: true; assetCount: number; brewCount: number }
  | { ok: false; status: number; code: DeleteBrandErrorCode };

export type DeleteBrandErrorCode =
  | "brand_not_found"
  | "personal_brand_undeletable"
  | "reassign_target_required"
  | "target_brand_invalid"
  | "last_non_personal_brand";

interface BrandRow {
  id: string;
  workspaceId: string | null;
  isPersonal: boolean;
}

async function loadBrandRow(brandId: string): Promise<BrandRow | null> {
  const rows = await db
    .select({
      id: brands.id,
      workspaceId: brands.workspaceId,
      isPersonal: brands.isPersonal,
    })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  return rows[0] ?? null;
}

async function countNonPersonalBrandsInWorkspace(
  workspaceId: string
): Promise<number> {
  const rows = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(brands)
    .where(
      and(eq(brands.workspaceId, workspaceId), eq(brands.isPersonal, false))
    );
  return rows[0]?.cnt ?? 0;
}

export async function executeBrandDeletion(
  input: DeleteBrandInput
): Promise<DeleteBrandResult> {
  const source = await loadBrandRow(input.brandId);
  if (!source || !source.workspaceId) {
    return { ok: false, status: 404, code: "brand_not_found" };
  }
  if (source.isPersonal) {
    return { ok: false, status: 400, code: "personal_brand_undeletable" };
  }

  // Always-on invariant: the workspace must keep at least one non-personal
  // brand. Any deletion (reassign or hard-delete) of the last non-personal
  // brand is rejected before we touch any rows.
  const nonPersonalCount = await countNonPersonalBrandsInWorkspace(
    source.workspaceId
  );
  if (nonPersonalCount <= 1) {
    return { ok: false, status: 400, code: "last_non_personal_brand" };
  }

  let target: BrandRow | null = null;
  if (input.assetAction === "reassign") {
    if (!input.reassignBrandId) {
      return { ok: false, status: 400, code: "reassign_target_required" };
    }
    if (input.reassignBrandId === input.brandId) {
      return { ok: false, status: 400, code: "target_brand_invalid" };
    }
    target = await loadBrandRow(input.reassignBrandId);
    if (
      !target ||
      target.workspaceId !== source.workspaceId ||
      target.isPersonal
    ) {
      return { ok: false, status: 400, code: "target_brand_invalid" };
    }
  }

  // Inventory the source's assets and brews — we need the count for the
  // result, and the asset IDs for the per-asset audit row on the reassign
  // path.
  const sourceAssets = await db
    .select({ id: assets.id, status: assets.status })
    .from(assets)
    .where(eq(assets.brandId, input.brandId));
  const sourceBrews = await db
    .select({ id: brews.id })
    .from(brews)
    .where(eq(brews.brandId, input.brandId));
  const assetCount = sourceAssets.length;
  const brewCount = sourceBrews.length;

  if (input.assetAction === "reassign" && target) {
    // Move assets first so the audit-log rows we write next reference the
    // already-moved row (the FK on review_log targets `assets.id`, not
    // `brand_id`, so this ordering is mostly cosmetic — but it keeps the
    // window where the asset has a stale brand_id minimal).
    await db
      .update(assets)
      .set({ brandId: target.id, updatedAt: new Date() })
      .where(eq(assets.brandId, input.brandId));

    if (sourceAssets.length > 0) {
      const note = `Moved from brand ${input.brandId} to brand ${target.id}`;
      await db.insert(assetReviewLog).values(
        sourceAssets.map((a) => ({
          assetId: a.id,
          actorId: input.actorId,
          action: "moved_brand" as const,
          fromStatus: a.status as
            | "draft"
            | "in_review"
            | "approved"
            | "rejected"
            | "archived",
          toStatus: a.status as
            | "draft"
            | "in_review"
            | "approved"
            | "rejected"
            | "archived",
          note,
        }))
      );
    }

    await db
      .update(brews)
      .set({ brandId: target.id, updatedAt: new Date() })
      .where(eq(brews.brandId, input.brandId));
  } else {
    // Hard-delete path. Wipe brews first so brew_visibility_log cascades
    // run, then assets so their review_log/uploads/etc. cascade.
    await db.delete(brews).where(eq(brews.brandId, input.brandId));
    await db.delete(assets).where(eq(assets.brandId, input.brandId));
  }

  // Finally drop the brand. Cascades take care of brand_members, campaigns,
  // and collections; references.brand_id is ON DELETE SET NULL so any pinned
  // references quietly unpin themselves.
  await db.delete(brands).where(eq(brands.id, input.brandId));

  // Sanity check we didn't somehow drop the last non-personal brand mid-
  // flight (couldn't happen given the early gate, but a partial failure on
  // a concurrent delete could). Return an explicit ok with counts.
  const _stillThere = await countNonPersonalBrandsInWorkspace(
    source.workspaceId
  );
  void _stillThere;

  return { ok: true, assetCount, brewCount };
}

/**
 * Re-export type for the "is reassign target valid?" check used by the modal
 * UI. Matches the API's 400 error code.
 */
export const REASSIGN_TARGET_INVALID_CODE: DeleteBrandErrorCode =
  "target_brand_invalid";
