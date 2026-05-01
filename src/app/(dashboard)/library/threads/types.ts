/**
 * Shared client types for the thread surface (Phase 3 / US1).
 *
 * `ClientMessage` mirrors `HydratedMessage` from the server (`src/lib/threads/hydrate.ts`)
 * with the JSON-serialized shapes (timestamps as ISO strings, not Date) plus
 * Phase-3-specific optimistic-state fields:
 *
 *   - `pendingState`   — `"pending" | "failed" | undefined` for in-flight sends.
 *   - `clientTempId`   — set on optimistic locals; the server echo carries it
 *                        back so the reducer can reconcile by id.
 *
 * Phase 4+ will add reactions/mentions UI; the wire shape already includes
 * those fields (they hydrate as empty arrays for v1) so the type is
 * forward-compatible.
 */

export interface ClientMessageAuthor {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface ClientMessageAttachment {
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

export interface ClientMessageReaction {
  emoji: string;
  count: number;
  reactors: { userId: string; displayName: string | null }[];
  viewerReacted: boolean;
}

export interface ClientMessageMention {
  userId: string;
  displayName: string | null;
}

export type ClientMessagePendingState = "pending" | "failed" | undefined;

export interface ClientMessage {
  id: string;
  threadId: string;
  workspaceId: string;
  authorId: string;
  parentMessageId: string | null;
  body: string | null;
  // ISO-8601 strings — the response is JSON, not Drizzle-deserialized.
  // Keep this loose so the reducer can accept either at the boundary.
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  attachments: ClientMessageAttachment[];
  reactions: ClientMessageReaction[];
  mentions: ClientMessageMention[];
  author: ClientMessageAuthor;

  // Optimistic UI fields — undefined for server-confirmed rows.
  clientTempId?: string;
  pendingState?: ClientMessagePendingState;
  errorMessage?: string;
}

export interface ClientThread {
  id: string;
  assetId: string;
  workspaceId: string;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
}
