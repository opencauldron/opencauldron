/**
 * Workspace-member resolver for `@`-mentions (T013).
 *
 * Returns `{ id, displayName, avatarUrl, handle }` for every workspace
 * member, suitable for the typeahead picker AND the post-time validation
 * step that turns `@sasha` text into a structured mention row.
 *
 * Caching policy:
 *   * Per-request memo via `React.cache` so a single thread-create handler
 *     that calls this twice (parse + post-store) only pays one round trip.
 *   * No cross-request cache — workspace membership changes need to be
 *     reflected immediately for security (a removed member must not be
 *     mentionable on the next request).
 *
 * Handle derivation: lowercase the email local-part (the part before `@`),
 * fall back to a sanitized display name when email is missing. The DB
 * doesn't store handles natively today; this is good enough for v1 chat.
 */

import { and, desc, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/lib/db";
import { users, workspaceMembers } from "@/lib/db/schema";
import type { BodyMember } from "./body-parse";

export interface MentionableMember extends BodyMember {
  avatarUrl: string | null;
  email: string;
}

function deriveHandleFromUser(email: string, name: string | null): string {
  const local = email.split("@")[0] ?? "";
  const seed = local || name || "user";
  return seed.toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

async function loadWorkspaceMembersUncached(
  workspaceId: string
): Promise<MentionableMember[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(desc(workspaceMembers.createdAt));

  return rows.map((r) => {
    const displayName = r.name ?? r.email.split("@")[0] ?? "Someone";
    return {
      id: r.id,
      email: r.email,
      displayName,
      handle: deriveHandleFromUser(r.email, r.name),
      avatarUrl: r.image,
    };
  });
}

/**
 * `React.cache` produces a per-request memoized function. Inside a route
 * handler that's invoked twice with the same workspaceId, the second call
 * returns the cached value instantly. Outside a request (e.g. in tests), it
 * still works — `cache` no-ops there.
 */
export const resolveWorkspaceMembersForMention = cache(
  async (workspaceId: string): Promise<MentionableMember[]> => {
    return loadWorkspaceMembersUncached(workspaceId);
  }
);

/**
 * Filter to a specific user — useful for the post-time validator that needs
 * to confirm a mentioned user is actually a workspace member before writing
 * the message_mentions row.
 */
export async function isMentionableInWorkspace(
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const rows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    )
    .limit(1);
  return rows.length > 0;
}
