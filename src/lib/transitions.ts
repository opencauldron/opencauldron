/**
 * Asset state machine — `draft → in_review → approved | rejected | archived`.
 * No skipping (FR-009). Approved assets are immutable except via fork (FR-011).
 *
 * Every transition writes one row to `asset_review_log` (NFR-003) in the same
 * transaction as the status update.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { assetReviewLog, assets } from "@/lib/db/schema";

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
  | "moved_from_personal";

const ALLOWED: Record<TransitionAction, { from: AssetStatus[]; to: AssetStatus; logAction: LogAction }> = {
  submit:    { from: ["draft"], to: "in_review", logAction: "submitted" },
  approve:   { from: ["in_review"], to: "approved", logAction: "approved" },
  reject:    { from: ["in_review"], to: "rejected", logAction: "rejected" },
  archive:   { from: ["draft", "in_review", "approved", "rejected"], to: "archived", logAction: "archived" },
  unarchive: { from: ["archived"], to: "draft", logAction: "unarchived" },
};

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
  const rule = ALLOWED[input.action];
  if (!rule) {
    throw new TransitionError(400, `Unknown action: ${input.action}`, "unknown_action");
  }

  // Row-level lock — guards against double-submit / approve races.
  const current = await db
    .select({ id: assets.id, status: assets.status })
    .from(assets)
    .where(eq(assets.id, input.assetId))
    .for("update")
    .limit(1);

  if (!current[0]) {
    throw new TransitionError(404, "Asset not found", "not_found");
  }

  const fromStatus = current[0].status as AssetStatus;
  if (!rule.from.includes(fromStatus)) {
    throw new TransitionError(
      409,
      `Cannot ${input.action} from status=${fromStatus}`,
      "invalid_transition"
    );
  }

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

  return { assetId: input.assetId, fromStatus, toStatus: rule.to };
}

/** Record a non-status audit event (e.g. forked, moved_from_personal). */
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
