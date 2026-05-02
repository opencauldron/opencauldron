/**
 * Asset state machine — `draft → in_review → approved | rejected | archived`.
 * No skipping (FR-009). Approved assets are immutable except via fork (FR-011).
 *
 * Every transition writes one row to `asset_review_log` (NFR-003) in the same
 * transaction as the status update.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { assetReviewLog, assets, brands } from "@/lib/db/schema";
import { emitActivity, type ActivityVerb } from "@/lib/activity";
import {
  canApprove,
  canRejectOrArchive,
  canSubmit,
  type BrandContext,
  type RoleContext,
} from "@/lib/workspace/permissions";

export type AssetStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "rejected"
  | "archived";

export type TransitionAction =
  | "submit"
  | "approve"
  | "reject"
  | "archive"
  | "unarchive";

export type LogAction =
  | "submitted"
  | "approved"
  | "rejected"
  | "archived"
  | "unarchived"
  | "forked"
  | "moved_from_personal"
  | "moved_brand";

export const ALLOWED_TRANSITIONS: Record<
  TransitionAction,
  { from: AssetStatus[]; to: AssetStatus; logAction: LogAction }
> = {
  submit:    { from: ["draft"], to: "in_review", logAction: "submitted" },
  approve:   { from: ["in_review"], to: "approved", logAction: "approved" },
  reject:    { from: ["in_review"], to: "rejected", logAction: "rejected" },
  archive:   { from: ["draft", "in_review", "approved", "rejected"], to: "archived", logAction: "archived" },
  unarchive: { from: ["archived"], to: "draft", logAction: "unarchived" },
};

/**
 * Pure state-machine validator. Returns the rule for a given (status, action)
 * tuple, or throws TransitionError when illegal. No DB access.
 */
export function validateTransition(
  fromStatus: AssetStatus,
  action: TransitionAction
): { to: AssetStatus; logAction: LogAction } {
  const rule = ALLOWED_TRANSITIONS[action];
  if (!rule) {
    throw new TransitionError(400, `Unknown action: ${action}`, "unknown_action");
  }
  if (!rule.from.includes(fromStatus)) {
    throw new TransitionError(
      409,
      `Cannot ${action} from status=${fromStatus}`,
      "invalid_transition"
    );
  }
  return { to: rule.to, logAction: rule.logAction };
}

export class TransitionError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
    this.name = "TransitionError";
  }
}

export interface TransitionInput {
  assetId: string;
  actorId: string;
  action: TransitionAction;
  note?: string;
}

export interface TransitionResult {
  assetId: string;
  fromStatus: AssetStatus;
  toStatus: AssetStatus;
}

/**
 * Apply a state transition. Pre-conditions (caller must enforce):
 *   - permission check via `permissions.canSubmit / canApprove / ...`
 *   - Personal-brand carve-out (only the caller knows the brand context)
 *
 * This helper validates the from-state and writes the audit row atomically.
 */
export async function transitionAsset(
  input: TransitionInput
): Promise<TransitionResult> {
  // Row-level lock — guards against double-submit / approve races. Pull
  // brand_id alongside status so the activity emission below has the brand
  // context without a second round-trip.
  const current = await db
    .select({
      id: assets.id,
      status: assets.status,
      brandId: assets.brandId,
    })
    .from(assets)
    .where(eq(assets.id, input.assetId))
    .for("update")
    .limit(1);

  if (!current[0]) {
    throw new TransitionError(404, "Asset not found", "not_found");
  }

  const fromStatus = current[0].status as AssetStatus;
  const rule = validateTransition(fromStatus, input.action);

  await db
    .update(assets)
    .set({ status: rule.to, updatedAt: new Date() })
    .where(eq(assets.id, input.assetId));

  await db.insert(assetReviewLog).values({
    assetId: input.assetId,
    actorId: input.actorId,
    action: rule.logAction,
    fromStatus,
    toStatus: rule.to,
    note: input.note ?? null,
  });

  // Activity feed (US2 / FR-002). Submit / approve / reject map onto the
  // three feed verbs; archive / unarchive are local audit-only and do not
  // surface in the feed (no acceptance criterion in spec FR-004 covers
  // them). Visibility is `brand` for all three — the route layer already
  // forbids these transitions on Personal brands
  // (`personal_brand_no_review`), so by construction the asset's brand is
  // managed and a brand-scoped event is the right scope.
  const verb = mapTransitionToActivityVerb(input.action);
  if (verb && current[0].brandId) {
    // Look up workspace_id off the brand. One extra round-trip per
    // transition; keeps the helper self-contained without forcing every
    // caller to thread workspace context through.
    const [brandRow] = await db
      .select({ workspaceId: brands.workspaceId })
      .from(brands)
      .where(eq(brands.id, current[0].brandId))
      .limit(1);
    if (brandRow?.workspaceId) {
      await emitActivity(db, {
        actorId: input.actorId,
        verb,
        objectType: "asset",
        objectId: input.assetId,
        workspaceId: brandRow.workspaceId,
        brandId: current[0].brandId,
        visibility: "brand",
        metadata: {
          fromStatus,
          toStatus: rule.to,
          ...(input.note ? { note: input.note } : {}),
        },
      });
    }
  }

  return { assetId: input.assetId, fromStatus, toStatus: rule.to };
}

/**
 * Map a state-machine action to its activity-feed verb. `archive` and
 * `unarchive` do not have feed verbs in v1 (spec FR-004 lists only the
 * seven shipped verbs); they remain in `asset_review_log` for audit.
 */
function mapTransitionToActivityVerb(
  action: TransitionAction
): ActivityVerb | null {
  switch (action) {
    case "submit":
      return "generation.submitted";
    case "approve":
      return "generation.approved";
    case "reject":
      return "generation.rejected";
    case "archive":
    case "unarchive":
      return null;
  }
}

/** Record a non-status audit event (e.g. forked, moved_brand). */
export async function logReviewEvent(input: {
  assetId: string;
  actorId: string;
  action: LogAction;
  fromStatus: AssetStatus | null;
  toStatus: AssetStatus;
  note?: string;
}): Promise<void> {
  await db.insert(assetReviewLog).values({
    assetId: input.assetId,
    actorId: input.actorId,
    action: input.action,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    note: input.note ?? null,
  });
}

/**
 * Pure action-permission gate. Composes the role/permissions matrix with the
 * Personal-brand carve-outs and self-approval semantics. Returns the http
 * shape the route handler should emit on denial. No DB access — tests cover
 * every cell of the matrix without spinning up Postgres.
 *
 * Personal-brand handling:
 *   - submit / approve / reject are rejected outright (`personal_brand_no_review`)
 *     because Personal assets cannot enter the review pipeline (FR-006b).
 *   - archive / unarchive are allowed when the actor is the Personal brand
 *     owner — even if the brand_member row is missing — so users always
 *     control their own scratch space.
 */
export type ActionGateResult =
  | { ok: true }
  | { ok: false; status: number; code: string };

export function checkTransitionPermission(
  action: TransitionAction,
  ctx: RoleContext,
  asset: { brandId: string | null; userId: string },
  brand: BrandContext
): ActionGateResult {
  const assetForGate = { brandId: brand.id, userId: asset.userId };
  switch (action) {
    case "submit":
      if (brand.isPersonal) {
        return { ok: false, status: 403, code: "personal_brand_no_review" };
      }
      if (!canSubmit(ctx, assetForGate, brand)) {
        return { ok: false, status: 403, code: "forbidden" };
      }
      return { ok: true };
    case "approve":
      if (brand.isPersonal) {
        return { ok: false, status: 403, code: "personal_brand_no_review" };
      }
      if (!canApprove(ctx, assetForGate, brand)) {
        if (asset.userId === ctx.userId && !brand.selfApprovalAllowed) {
          return { ok: false, status: 403, code: "self_approval_blocked" };
        }
        return { ok: false, status: 403, code: "forbidden" };
      }
      return { ok: true };
    case "reject":
      if (brand.isPersonal) {
        return { ok: false, status: 403, code: "personal_brand_no_review" };
      }
      if (!canRejectOrArchive(ctx, assetForGate, brand)) {
        return { ok: false, status: 403, code: "forbidden" };
      }
      return { ok: true };
    case "archive":
    case "unarchive":
      if (brand.isPersonal && asset.userId === ctx.userId) {
        return { ok: true };
      }
      if (!canRejectOrArchive(ctx, assetForGate, brand)) {
        return { ok: false, status: 403, code: "forbidden" };
      }
      return { ok: true };
  }
}

/** Mutation gate — every UPDATE on assets MUST consult this before touching an `approved` row. */
export async function assertMutable(assetId: string): Promise<void> {
  const rows = await db
    .select({ status: assets.status })
    .from(assets)
    .where(and(eq(assets.id, assetId), sql`${assets.status} <> 'approved'`))
    .limit(1);
  if (!rows[0]) {
    throw new TransitionError(
      409,
      "Approved assets are immutable; fork to edit.",
      "asset_immutable"
    );
  }
}
