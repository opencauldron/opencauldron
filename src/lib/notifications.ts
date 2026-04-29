/**
 * In-app notification writers and recipient resolvers.
 *
 * Boundary: pure DB helpers. No auth, no session lookups — callers pass user
 * IDs directly. The route layer is responsible for authentication.
 *
 * Recipient policy for `asset_submitted` (the only fan-out event today):
 *   * brand_members with role = brand_manager on the asset's brand
 *   * workspace_members with role = owner | admin on the brand's workspace
 *   * minus the actor (no self-pings)
 *
 * `asset_approved` and `asset_rejected` target only the uploader (and only
 * when the uploader is not the actor).
 */

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  brandMembers,
  notifications,
  users,
  workspaceMembers,
} from "@/lib/db/schema";

export type NotificationType =
  | "asset_submitted"
  | "asset_approved"
  | "asset_rejected"
  | "brand_invite"
  | "workspace_invite"
  | "review_assigned";

export interface NotificationInput {
  userId: string;
  workspaceId: string;
  actorId?: string | null;
  type: NotificationType;
  payload?: Record<string, unknown>;
  href?: string | null;
}

export async function createNotification(
  input: NotificationInput
): Promise<{ id: string }> {
  const [row] = await db
    .insert(notifications)
    .values({
      userId: input.userId,
      workspaceId: input.workspaceId,
      actorId: input.actorId ?? null,
      type: input.type,
      payload: input.payload ?? {},
      href: input.href ?? null,
    })
    .returning({ id: notifications.id });
  return { id: row.id };
}

export async function createNotifications(
  inputs: NotificationInput[]
): Promise<number> {
  if (inputs.length === 0) return 0;
  const rows = await db
    .insert(notifications)
    .values(
      inputs.map((i) => ({
        userId: i.userId,
        workspaceId: i.workspaceId,
        actorId: i.actorId ?? null,
        type: i.type,
        payload: i.payload ?? {},
        href: i.href ?? null,
      }))
    )
    .returning({ id: notifications.id });
  return rows.length;
}

export async function markAllRead(
  userId: string,
  workspaceId: string
): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.workspaceId, workspaceId),
        isNull(notifications.readAt)
      )
    )
    .returning({ id: notifications.id });
  return rows.length;
}

export async function markRead(
  userId: string,
  notificationId: string
): Promise<boolean> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId)
      )
    )
    .returning({ id: notifications.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Recipient resolvers
// ---------------------------------------------------------------------------

export interface SubmitRecipientInput {
  actorId: string;
  brandMembers: Array<{ userId: string; role: "brand_manager" | "creator" | "viewer" }>;
  workspaceMembers: Array<{ userId: string; role: "owner" | "admin" | "member" }>;
}

/**
 * Pure recipient resolver — extracted so it can be unit-tested without DB.
 * Returns the deduped set of user IDs that should receive an
 * `asset_submitted` notification.
 */
export function resolveSubmitRecipients(input: SubmitRecipientInput): string[] {
  const recipients = new Set<string>();
  for (const m of input.brandMembers) {
    if (m.role === "brand_manager") recipients.add(m.userId);
  }
  for (const m of input.workspaceMembers) {
    if (m.role === "owner" || m.role === "admin") recipients.add(m.userId);
  }
  recipients.delete(input.actorId);
  return Array.from(recipients);
}

/**
 * DB-backed wrapper around `resolveSubmitRecipients`. Reads brand_members on
 * the brand and workspace_members on the workspace in parallel, then applies
 * the pure resolver.
 */
export async function loadSubmitRecipients(args: {
  actorId: string;
  brandId: string;
  workspaceId: string;
}): Promise<string[]> {
  const [brandRows, wsRows] = await Promise.all([
    db
      .select({ userId: brandMembers.userId, role: brandMembers.role })
      .from(brandMembers)
      .where(eq(brandMembers.brandId, args.brandId)),
    db
      .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, args.workspaceId)),
  ]);
  return resolveSubmitRecipients({
    actorId: args.actorId,
    brandMembers: brandRows as SubmitRecipientInput["brandMembers"],
    workspaceMembers: wsRows as SubmitRecipientInput["workspaceMembers"],
  });
}

// ---------------------------------------------------------------------------
// Read-side query for the bell feed
// ---------------------------------------------------------------------------

export interface FeedItem {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
  actor: { id: string; name: string | null; image: string | null } | null;
}

/**
 * Most-recent-N feed for (user, workspace) plus the unread count. Single
 * round-trip via two queries; we deliberately don't bother with a window
 * function because N is tiny.
 */
export async function loadFeed(args: {
  userId: string;
  workspaceId: string;
  limit?: number;
}): Promise<{ items: FeedItem[]; unreadCount: number }> {
  const limit = args.limit ?? 20;

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      payload: notifications.payload,
      href: notifications.href,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      actorId: users.id,
      actorName: users.name,
      actorImage: users.image,
    })
    .from(notifications)
    .leftJoin(users, eq(users.id, notifications.actorId))
    .where(
      and(
        eq(notifications.userId, args.userId),
        eq(notifications.workspaceId, args.workspaceId)
      )
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  const [unreadRow] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, args.userId),
        eq(notifications.workspaceId, args.workspaceId),
        isNull(notifications.readAt)
      )
    );

  return {
    items: rows.map((r) => ({
      id: r.id,
      type: r.type as NotificationType,
      payload: r.payload,
      href: r.href,
      readAt: r.readAt,
      createdAt: r.createdAt,
      actor: r.actorId
        ? { id: r.actorId, name: r.actorName, image: r.actorImage }
        : null,
    })),
    unreadCount: unreadRow?.cnt ?? 0,
  };
}

// Re-export for callers that want to bulk-check ownership of multiple ids.
export async function notificationsOwnedBy(
  userId: string,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(eq(notifications.userId, userId), inArray(notifications.id, ids))
    );
  return new Set(rows.map((r) => r.id));
}
