/**
 * Message hydration helpers — reused by every list/detail endpoint so the
 * wire shape stays consistent.
 *
 * `hydrateMessages` takes a flat list of `messages` rows and returns the
 * same list with attachments, reactions, and mentions inlined per message.
 * Single batched round trip per relation via `inArray()`; total query count
 * is O(1) regardless of message count.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  messageAttachments,
  messageMentions,
  messageReactions,
  users,
} from "@/lib/db/schema";

export interface MessageRow {
  id: string;
  threadId: string;
  workspaceId: string;
  authorId: string;
  parentMessageId: string | null;
  body: string | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
}

export interface HydratedAttachment {
  id: string;
  kind: "upload" | "asset_ref" | "external_link";
  r2Key: string | null;
  r2Url: string | null;
  mimeType: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  assetId: string | null;
  url: string | null;
  displayName: string | null;
  position: number;
}

export interface HydratedReaction {
  emoji: string;
  count: number;
  /** First N reactor user ids (capped to 8 for the tooltip). */
  reactors: { userId: string; displayName: string | null }[];
  viewerReacted: boolean;
}

export interface HydratedMessage extends MessageRow {
  attachments: HydratedAttachment[];
  reactions: HydratedReaction[];
  mentions: { userId: string; displayName: string | null }[];
  author: { id: string; displayName: string | null; avatarUrl: string | null };
}

/**
 * Bulk-hydrate. Pass `viewerId` so the per-reaction `viewerReacted` flag
 * comes back populated.
 */
export async function hydrateMessages(
  rows: MessageRow[],
  viewerId: string
): Promise<HydratedMessage[]> {
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const authorIds = Array.from(new Set(rows.map((r) => r.authorId)));

  const [attachments, reactionRows, mentionRows, authorRows] = await Promise.all([
    db
      .select()
      .from(messageAttachments)
      .where(inArray(messageAttachments.messageId, ids)),
    db
      .select({
        messageId: messageReactions.messageId,
        userId: messageReactions.userId,
        emoji: messageReactions.emoji,
        userName: users.name,
      })
      .from(messageReactions)
      .leftJoin(users, eq(users.id, messageReactions.userId))
      .where(inArray(messageReactions.messageId, ids)),
    db
      .select({
        messageId: messageMentions.messageId,
        mentionedUserId: messageMentions.mentionedUserId,
        userName: users.name,
      })
      .from(messageMentions)
      .leftJoin(users, eq(users.id, messageMentions.mentionedUserId))
      .where(inArray(messageMentions.messageId, ids)),
    authorIds.length > 0
      ? db
          .select({ id: users.id, name: users.name, image: users.image })
          .from(users)
          .where(inArray(users.id, authorIds))
      : Promise.resolve([] as { id: string; name: string | null; image: string | null }[]),
  ]);

  const attachmentsByMsg = groupBy(attachments, (a) => a.messageId);
  const reactionsByMsg = groupBy(reactionRows, (r) => r.messageId);
  const mentionsByMsg = groupBy(mentionRows, (r) => r.messageId);
  const authorById = new Map(authorRows.map((a) => [a.id, a]));

  return rows.map((m) => {
    const author = authorById.get(m.authorId);
    return {
      ...m,
      attachments: (attachmentsByMsg.get(m.id) ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((a) => ({
          id: a.id,
          kind: a.kind,
          r2Key: a.r2Key,
          r2Url: a.r2Url,
          mimeType: a.mimeType,
          fileSize: a.fileSize,
          width: a.width,
          height: a.height,
          assetId: a.assetId,
          url: a.url,
          displayName: a.displayName,
          position: a.position,
        })),
      reactions: groupReactions(reactionsByMsg.get(m.id) ?? [], viewerId),
      mentions: (mentionsByMsg.get(m.id) ?? []).map((r) => ({
        userId: r.mentionedUserId,
        displayName: r.userName,
      })),
      author: {
        id: m.authorId,
        displayName: author?.name ?? null,
        avatarUrl: author?.image ?? null,
      },
    };
  });
}

function groupBy<T, K>(rows: T[], keyFn: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = keyFn(row);
    const arr = out.get(k);
    if (arr) arr.push(row);
    else out.set(k, [row]);
  }
  return out;
}

interface RawReaction {
  messageId: string;
  userId: string;
  emoji: string;
  userName: string | null;
}

function groupReactions(rows: RawReaction[], viewerId: string): HydratedReaction[] {
  const byEmoji = new Map<string, RawReaction[]>();
  for (const r of rows) {
    const arr = byEmoji.get(r.emoji);
    if (arr) arr.push(r);
    else byEmoji.set(r.emoji, [r]);
  }
  const out: HydratedReaction[] = [];
  for (const [emoji, group] of byEmoji) {
    out.push({
      emoji,
      count: group.length,
      reactors: group.slice(0, 8).map((g) => ({
        userId: g.userId,
        displayName: g.userName,
      })),
      viewerReacted: group.some((g) => g.userId === viewerId),
    });
  }
  // Stable order — most-reacted first; tie-break alphabetically.
  out.sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
  return out;
}
