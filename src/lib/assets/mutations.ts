/**
 * Shared per-asset mutation helpers.
 *
 * These extract the per-asset logic out of the `[id]/*` routes so the bulk
 * endpoints can run them in a tight loop without re-loading per-request
 * context (auth session, RoleContext, BrandContext) for every id.
 *
 * Each helper accepts pre-loaded contexts and throws `AssetMutationError` on
 * any user-visible failure. Bulk callers catch and surface in `failed[]`;
 * single-asset callers translate to the shape the existing route returned.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  assetCampaigns,
  assets,
  brands as brandsTable,
  campaigns,
} from "@/lib/db/schema";
import { deleteFile } from "@/lib/storage";
import {
  createNotification,
  createNotifications,
  loadSubmitRecipients,
  type NotificationInput,
} from "@/lib/notifications";
import {
  checkTransitionPermission,
  logReviewEvent,
  TransitionError,
  transitionAsset,
  type TransitionAction,
} from "@/lib/transitions";
import {
  canCreateAsset,
  isBrandManager,
  isWorkspaceAdmin,
  type BrandContext,
  type RoleContext,
} from "@/lib/workspace/permissions";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class AssetMutationError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "AssetMutationError";
  }
}

// ---------------------------------------------------------------------------
// Shared asset shape — minimum required fields per helper. Bulk callers
// hydrate this once with a single SELECT for all ids; single-asset callers
// load the row inline.
// ---------------------------------------------------------------------------

export interface MutableAsset {
  id: string;
  userId: string;
  brandId: string | null;
  status: "draft" | "in_review" | "approved" | "rejected" | "archived";
  prompt: string;
  r2Key: string;
  thumbnailR2Key: string | null;
  webpR2Key: string | null;
}

// ---------------------------------------------------------------------------
// Transition (submit / approve / reject / archive / unarchive)
// ---------------------------------------------------------------------------

export interface TransitionMutationInput {
  asset: MutableAsset;
  action: TransitionAction;
  ctx: RoleContext;
  brandCtx: BrandContext;
  actorId: string;
  note?: string;
}

export interface TransitionMutationResult {
  assetId: string;
  fromStatus: MutableAsset["status"];
  toStatus: MutableAsset["status"];
}

export async function transitionAssetMutation(
  input: TransitionMutationInput
): Promise<TransitionMutationResult> {
  const { asset, action, ctx, brandCtx, actorId, note } = input;

  if (!asset.brandId) {
    throw new AssetMutationError(
      "asset_missing_brand",
      "Asset has no brand context",
      409
    );
  }

  // Synthesize creator role on Personal brand if the membership row is missing
  // — mirrors the carve-out in /api/generate so users always control their own
  // scratch space.
  if (
    brandCtx.isPersonal &&
    brandCtx.ownerId === actorId &&
    !ctx.brandMemberships.has(brandCtx.id)
  ) {
    ctx.brandMemberships.set(brandCtx.id, "creator");
  }

  const allowed = checkTransitionPermission(action, ctx, asset, brandCtx);
  if (!allowed.ok) {
    throw new AssetMutationError(allowed.code, allowed.code, allowed.status);
  }

  try {
    const result = await transitionAsset({
      assetId: asset.id,
      actorId,
      action,
      note,
    });

    // Best-effort fan-out — match the single-asset route's fire-and-forget
    // pattern. A notification write failure must not cascade into the bulk
    // result; the audit log is the system of record.
    void fanOutNotifications({
      action,
      actorId,
      asset: { id: asset.id, userId: asset.userId, prompt: asset.prompt },
      brand: { id: brandCtx.id, workspaceId: brandCtx.workspaceId },
      note,
    }).catch((err) => {
      console.error("notifications.fanOut failed", err);
    });

    return {
      assetId: result.assetId,
      fromStatus: result.fromStatus,
      toStatus: result.toStatus,
    };
  } catch (err) {
    if (err instanceof TransitionError) {
      throw new AssetMutationError(err.code, err.message, err.status);
    }
    throw err;
  }
}

interface FanOutInput {
  action: TransitionAction;
  actorId: string;
  asset: { id: string; userId: string; prompt: string };
  brand: { id: string; workspaceId: string };
  note?: string;
}

async function fanOutNotifications(input: FanOutInput): Promise<void> {
  const { action, actorId, asset, brand, note } = input;
  if (action !== "submit" && action !== "approve" && action !== "reject") {
    return;
  }

  const [brandRow] = await db
    .select({ slug: brandsTable.slug, name: brandsTable.name })
    .from(brandsTable)
    .where(eq(brandsTable.id, brand.id))
    .limit(1);
  const brandSlug = brandRow?.slug ?? brand.id;
  const brandName = brandRow?.name ?? null;
  const reviewHref = `/brands/${brandSlug}/review`;
  const assetTitle = excerpt(asset.prompt);

  if (action === "submit") {
    const recipients = await loadSubmitRecipients({
      actorId,
      brandId: brand.id,
      workspaceId: brand.workspaceId,
    });
    const inputs: NotificationInput[] = recipients.map((userId) => ({
      userId,
      workspaceId: brand.workspaceId,
      actorId,
      type: "asset_submitted",
      payload: {
        assetId: asset.id,
        brandId: brand.id,
        brandName,
        assetTitle,
      },
      href: reviewHref,
    }));
    await createNotifications(inputs);
    return;
  }

  if (asset.userId === actorId) return;

  await createNotification({
    userId: asset.userId,
    workspaceId: brand.workspaceId,
    actorId,
    type: action === "approve" ? "asset_approved" : "asset_rejected",
    payload: {
      assetId: asset.id,
      brandId: brand.id,
      brandName,
      assetTitle,
      ...(note ? { note } : {}),
    },
    href: reviewHref,
  });
}

function excerpt(text: string, max = 80): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1) + "…";
}

// ---------------------------------------------------------------------------
// Reassign brand
// ---------------------------------------------------------------------------

export interface ReassignBrandInput {
  asset: MutableAsset;
  targetBrandId: string;
  ctx: RoleContext;
  sourceBrandCtx: BrandContext;
  destBrandCtx: BrandContext;
  actorId: string;
}

export interface ReassignBrandResult {
  assetId: string;
  brandId: string;
  status: "draft";
}

export async function reassignAssetBrand(
  input: ReassignBrandInput
): Promise<ReassignBrandResult> {
  const { asset, targetBrandId, ctx, sourceBrandCtx, destBrandCtx, actorId } =
    input;

  if (asset.status === "approved") {
    throw new AssetMutationError(
      "approved_immutable_fork_required",
      "Approved assets are immutable; fork to edit.",
      409
    );
  }
  if (!asset.brandId) {
    throw new AssetMutationError(
      "source_workspace_missing",
      "Asset has no source brand",
      500
    );
  }
  if (asset.brandId === targetBrandId) {
    throw new AssetMutationError(
      "target_same_as_source",
      "Source and destination brands are the same",
      400
    );
  }

  // Source permission gate.
  const isCreatorOfAsset = asset.userId === actorId;
  const sourceAllowed =
    isCreatorOfAsset ||
    isBrandManager(ctx, sourceBrandCtx.id) ||
    isWorkspaceAdmin(ctx);
  if (!sourceAllowed) {
    throw new AssetMutationError("forbidden", "Forbidden", 403);
  }

  if (destBrandCtx.workspaceId !== sourceBrandCtx.workspaceId) {
    throw new AssetMutationError(
      "cross_workspace_move_forbidden",
      "Cross-workspace move is not allowed",
      403
    );
  }
  if (destBrandCtx.isPersonal) {
    throw new AssetMutationError(
      "target_must_be_real_brand",
      "Destination must be a non-Personal brand",
      400
    );
  }

  // Destination permission gate — must be creator+ on destination.
  if (!canCreateAsset(ctx, destBrandCtx)) {
    throw new AssetMutationError("forbidden", "Forbidden", 403);
  }

  const fromStatus = asset.status;

  await db
    .update(assets)
    .set({ brandId: targetBrandId, status: "draft", updatedAt: new Date() })
    .where(eq(assets.id, asset.id));

  await logReviewEvent({
    assetId: asset.id,
    actorId,
    action: "moved_brand",
    fromStatus,
    toStatus: "draft",
  });

  return { assetId: asset.id, brandId: targetBrandId, status: "draft" };
}

// ---------------------------------------------------------------------------
// Set / add / remove campaigns
// ---------------------------------------------------------------------------

export type CampaignMode = "set" | "add" | "remove";

export interface SetAssetCampaignsInput {
  asset: MutableAsset;
  brandCtx: BrandContext;
  ctx: RoleContext;
  campaignIds: string[];
  mode: CampaignMode;
}

export interface SetAssetCampaignsResult {
  assetId: string;
  campaignIds: string[];
}

export async function setAssetCampaigns(
  input: SetAssetCampaignsInput
): Promise<SetAssetCampaignsResult> {
  const { asset, brandCtx, ctx, campaignIds, mode } = input;

  if (!canCreateAsset(ctx, brandCtx)) {
    throw new AssetMutationError("forbidden", "Forbidden", 403);
  }

  const desired = Array.from(new Set(campaignIds));

  // All campaign ids must belong to the asset's brand. Catches typos and
  // cross-brand leakage; matches the single-asset route's guard.
  if (desired.length > 0) {
    const valid = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(
        and(eq(campaigns.brandId, brandCtx.id), inArray(campaigns.id, desired))
      );
    if (valid.length !== desired.length) {
      throw new AssetMutationError(
        "campaigns_not_in_brand",
        "Some campaigns do not belong to the asset's brand",
        400
      );
    }
  }

  if (mode === "set") {
    await db.delete(assetCampaigns).where(eq(assetCampaigns.assetId, asset.id));
    if (desired.length > 0) {
      await db
        .insert(assetCampaigns)
        .values(desired.map((cid) => ({ assetId: asset.id, campaignId: cid })));
    }
    return { assetId: asset.id, campaignIds: desired };
  }

  if (mode === "add") {
    if (desired.length > 0) {
      await db
        .insert(assetCampaigns)
        .values(desired.map((cid) => ({ assetId: asset.id, campaignId: cid })))
        .onConflictDoNothing();
    }
  } else {
    if (desired.length > 0) {
      await db
        .delete(assetCampaigns)
        .where(
          and(
            eq(assetCampaigns.assetId, asset.id),
            inArray(assetCampaigns.campaignId, desired)
          )
        );
    }
  }

  // Return the final set of campaigns so callers can reflect state
  // accurately after add/remove.
  const finalRows = await db
    .select({ campaignId: assetCampaigns.campaignId })
    .from(assetCampaigns)
    .where(eq(assetCampaigns.assetId, asset.id));
  return {
    assetId: asset.id,
    campaignIds: finalRows.map((r) => r.campaignId),
  };
}

// ---------------------------------------------------------------------------
// Delete asset
// ---------------------------------------------------------------------------

export interface DeleteAssetInput {
  asset: MutableAsset;
  ctx: RoleContext;
  brandCtx: BrandContext | null;
  actorId: string;
}

export async function deleteAsset(input: DeleteAssetInput): Promise<void> {
  const { asset, ctx, brandCtx, actorId } = input;

  if (asset.status === "approved") {
    throw new AssetMutationError(
      "asset_immutable",
      "Approved assets are immutable; archive instead.",
      409
    );
  }

  // Permission check the single-asset route was missing — creator OR
  // brand_manager on the asset's brand OR workspace owner/admin.
  const isCreator = asset.userId === actorId;
  const allowed =
    isCreator ||
    isWorkspaceAdmin(ctx) ||
    (brandCtx ? isBrandManager(ctx, brandCtx.id) : false);
  if (!allowed) {
    throw new AssetMutationError("forbidden", "Forbidden", 403);
  }

  // Delete from storage. Best-effort — orphaned R2 objects are recoverable
  // out-of-band; failing the user-facing delete because of a transient R2
  // hiccup is the worse outcome.
  try {
    await deleteFile(asset.r2Key);
    if (asset.thumbnailR2Key) {
      await deleteFile(asset.thumbnailR2Key);
    }
    if (asset.webpR2Key) {
      await deleteFile(asset.webpR2Key);
    }
  } catch (error) {
    console.error("Failed to delete from storage:", error);
  }

  await db.delete(assets).where(eq(assets.id, asset.id));
}
