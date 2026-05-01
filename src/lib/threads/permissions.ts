/**
 * Thread permissions (T008).
 *
 * Threads inherit workspace permissions transitively via `assets.brandId →
 * brands.workspaceId → workspaceMembers`. Anyone in the asset's workspace
 * may read/post/edit-own/delete-own. Workspace owners can moderate (delete
 * other people's messages — FR-019).
 *
 * Mirrors the patterns in `src/lib/workspace/permissions.ts` — same
 * PermissionError shape, same throw-on-deny ergonomics. Keep the helpers
 * focused: this module does not reach into the asset_threads table directly,
 * just the asset → brand → workspace → membership chain.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  assets,
  brands,
  workspaceMembers,
} from "@/lib/db/schema";
import { PermissionError } from "@/lib/workspace/permissions";

export { PermissionError };

export interface ThreadPermissionContext {
  workspaceId: string;
  brandId: string | null;
  assetUserId: string;
  role: "owner" | "admin" | "member";
}

/**
 * Resolve the workspace + role for `(userId, assetId)` and throw if the user
 * is not a workspace member. Used as the gate at the top of every thread
 * route handler.
 */
export async function assertWorkspaceMemberForAsset(
  userId: string,
  assetId: string
): Promise<ThreadPermissionContext> {
  // One round-trip: asset → brand → workspace + membership join. If the join
  // returns no row the user isn't a member; throw 403. If the asset doesn't
  // exist we still get no row (LEFT JOIN of memberships against a missing
  // asset id collapses to nothing) — that's a 404, not a 403.

  const assetRows = await db
    .select({
      assetUserId: assets.userId,
      brandId: assets.brandId,
      workspaceId: brands.workspaceId,
    })
    .from(assets)
    .leftJoin(brands, eq(brands.id, assets.brandId))
    .where(eq(assets.id, assetId))
    .limit(1);

  const asset = assetRows[0];
  if (!asset) {
    throw new PermissionError(404, "asset_not_found", "asset_not_found");
  }
  if (!asset.workspaceId) {
    // Personal-brand asset whose brand was deleted, or pre-migration shape.
    throw new PermissionError(404, "asset_workspace_unresolved", "asset_workspace_unresolved");
  }

  const memberRows = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.workspaceId, asset.workspaceId)
      )
    )
    .limit(1);

  const member = memberRows[0];
  if (!member) {
    throw new PermissionError(403, "not_a_workspace_member", "not_a_workspace_member");
  }

  return {
    workspaceId: asset.workspaceId,
    brandId: asset.brandId,
    assetUserId: asset.assetUserId,
    role: member.role as "owner" | "admin" | "member",
  };
}

/**
 * Variant for routes that already have a thread id (most of the message
 * endpoints) — joins through asset_threads to land in the same shape.
 *
 * Note: passes the SQL through drizzle as a join chain so a single round-trip
 * resolves both workspace membership and the thread→asset linkage.
 */
export async function assertWorkspaceMemberForThread(
  userId: string,
  threadId: string
): Promise<ThreadPermissionContext & { threadId: string; assetId: string }> {
  // We deliberately keep the import local — `assetThreads` is dynamically
  // imported here to avoid a circular module load if other helpers in this
  // file ever grow to import schema directly during boot.
  const { assetThreads } = await import("@/lib/db/schema");

  const rows = await db
    .select({
      threadId: assetThreads.id,
      assetId: assetThreads.assetId,
      workspaceId: assetThreads.workspaceId,
      brandId: assets.brandId,
      assetUserId: assets.userId,
    })
    .from(assetThreads)
    .innerJoin(assets, eq(assets.id, assetThreads.assetId))
    .where(eq(assetThreads.id, threadId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new PermissionError(404, "thread_not_found", "thread_not_found");
  }

  const memberRows = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.workspaceId, row.workspaceId)
      )
    )
    .limit(1);

  const member = memberRows[0];
  if (!member) {
    throw new PermissionError(403, "not_a_workspace_member", "not_a_workspace_member");
  }

  return {
    threadId: row.threadId,
    assetId: row.assetId,
    workspaceId: row.workspaceId,
    brandId: row.brandId,
    assetUserId: row.assetUserId,
    role: member.role as "owner" | "admin" | "member",
  };
}

/**
 * Moderation gate (FR-019) — workspace owners can delete any message in
 * their workspace's threads. Admins/members fall through to author-only.
 */
export function assertCanModerate(role: "owner" | "admin" | "member"): void {
  if (role === "owner") return;
  throw new PermissionError(403, "moderator_only", "moderator_only");
}

export function canModerate(role: "owner" | "admin" | "member"): boolean {
  return role === "owner";
}
