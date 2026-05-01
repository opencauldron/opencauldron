"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { BodyMember } from "@/lib/threads/body-parse";
import { Composer, type ReplyTarget } from "./composer";
import { MessageList } from "./message-list";
import { ThreadEmptyState } from "./thread-empty-state";
import { useThreadStream } from "./use-thread-stream";
import type { MentionMember } from "./mention-typeahead";
import type { ClientMessage, ClientThread } from "./types";

// ---------------------------------------------------------------------------
// Thread panel orchestrator (Phase 4 — adds member roster, reactions, replies).
// ---------------------------------------------------------------------------

export interface ThreadPanelProps {
  assetId: string;
  viewer: {
    id: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  highlightMessageId?: string | null;
}

export function ThreadPanel({
  assetId,
  viewer,
  highlightMessageId,
}: ThreadPanelProps) {
  type BootstrapState =
    | { status: "loading"; thread: null; error: null }
    | { status: "ready"; thread: ClientThread; error: null }
    | { status: "error"; thread: null; error: string };

  const [boot, setBoot] = useState<BootstrapState>({
    status: "loading",
    thread: null,
    error: null,
  });

  // Workspace member roster — fetched once at panel-mount, reused by the
  // mention typeahead AND the reaction-event display-name resolver.
  const [members, setMembers] = useState<MentionMember[]>([]);
  const membersById = useMemo(() => {
    const map = new Map<string, MentionMember>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);

  // Used by the reducer for SSE-pushed reaction deltas — falls back to null
  // (which the chip tooltip renders as "Someone").
  const resolveDisplayName = useCallback(
    (userId: string) => membersById.get(userId)?.displayName ?? null,
    [membersById]
  );

  const stream = useThreadStream({
    threadId: boot.thread?.id ?? null,
    enabled: boot.thread !== null,
    viewerId: viewer.id,
    resolveDisplayName,
  });

  // ---- Reply target + jump-to-message state -------------------------------
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  // The panel-owned highlight target: starts as the URL-driven one, can be
  // bumped via `jumpToMessage()` to scroll + pulse a different row. The token
  // bumps to retrigger the pulse animation when the user re-jumps.
  const [highlight, setHighlight] = useState<{
    id: string | null;
    token: number;
  }>({ id: highlightMessageId ?? null, token: 0 });

  // Re-sync the highlight when the deep-link prop changes after panel mount.
  // Pattern: track the previous prop value alongside `highlight`; setState
  // during render is legal when guarded by a value change. See
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [prevHighlightProp, setPrevHighlightProp] = useState(
    highlightMessageId ?? null
  );
  const incomingHighlight = highlightMessageId ?? null;
  if (incomingHighlight !== prevHighlightProp) {
    setPrevHighlightProp(incomingHighlight);
    setHighlight((h) => ({ id: incomingHighlight, token: h.token + 1 }));
  }

  const jumpToMessage = useCallback((messageId: string) => {
    setHighlight((h) => ({ id: messageId, token: h.token + 1 }));
  }, []);

  // ---- Bootstrap thread + roster ------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/threads/by-asset/${assetId}`);
        if (cancelled) return;
        if (!res.ok) {
          setBoot({
            status: "error",
            thread: null,
            error:
              res.status === 403
                ? "You don't have access to this thread."
                : `Couldn't load thread (status ${res.status}).`,
          });
          return;
        }
        const json = (await res.json()) as {
          thread: ClientThread;
          messages: ClientMessage[];
          nextCursor: string | null;
        };
        if (cancelled) return;
        setBoot({ status: "ready", thread: json.thread, error: null });
        stream.setInitial(json.messages, json.nextCursor);

        // Roster fetch — second round trip but parallelizable to the SSE
        // open. Errors are non-fatal: the typeahead just won't have data.
        try {
          const memberRes = await fetch(
            `/api/threads/${json.thread.id}/members`
          );
          if (cancelled || !memberRes.ok) return;
          const memberJson = (await memberRes.json()) as {
            members: MentionMember[];
          };
          if (!cancelled) setMembers(memberJson.members);
        } catch {
          // Ignore — roster is best-effort.
        }
      } catch (err) {
        if (cancelled) return;
        setBoot({
          status: "error",
          thread: null,
          error:
            err instanceof Error
              ? err.message
              : "Couldn't load thread. Try again.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `stream.setInitial` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  const failed = stream.state.messages.find(
    (m) => m.pendingState === "failed" && m.authorId === viewer.id
  );

  // BodyMember[] for chip rendering — derive from the typeahead roster
  // first; fall back to message authors so chips resolve even if the
  // roster fetch hasn't returned yet.
  const bodyMembers: BodyMember[] = useMemo(() => {
    const out = new Map<string, BodyMember>();
    for (const m of members) {
      out.set(m.handle, {
        id: m.id,
        handle: m.handle,
        displayName: m.displayName,
      });
    }
    if (out.size === 0) {
      for (const msg of stream.state.messages) {
        for (const mention of msg.mentions) {
          if (!mention.displayName) continue;
          const handle = mention.displayName
            .toLowerCase()
            .replace(/[^a-z0-9._-]/g, "");
          if (!out.has(handle)) {
            out.set(handle, {
              id: mention.userId,
              handle,
              displayName: mention.displayName,
            });
          }
        }
      }
    }
    return Array.from(out.values());
  }, [members, stream.state.messages]);

  // ---- Imperative actions wired into rows ---------------------------------

  const handleEdit = useCallback(
    async (messageId: string, body: string) => {
      const t = boot.thread;
      if (!t) return { ok: false, error: "thread_not_ready" };
      try {
        const res = await fetch(
          `/api/threads/${t.id}/messages/${messageId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body }),
          }
        );
        if (!res.ok) {
          const json = await safeJson(res);
          return {
            ok: false,
            error:
              res.status === 403
                ? "You can only edit your own messages."
                : (json?.error as string) ?? `Edit failed (${res.status}).`,
          };
        }
        const json = (await res.json()) as { message: ClientMessage };
        stream.applyLocalEdit(json.message);
        return { ok: true };
      } catch {
        return { ok: false, error: "Network error. Try again." };
      }
    },
    [stream, boot.thread]
  );

  const handleDelete = useCallback(
    async (messageId: string) => {
      const t = boot.thread;
      if (!t) return { ok: false, error: "thread_not_ready" };
      stream.applyLocalDelete(messageId);
      try {
        const res = await fetch(
          `/api/threads/${t.id}/messages/${messageId}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          toast.error("Couldn't delete that message.");
          return { ok: false };
        }
        return { ok: true };
      } catch {
        toast.error("Couldn't delete — check your connection.");
        return { ok: false };
      }
    },
    [stream, boot.thread]
  );

  const handleReply = useCallback(
    (target: ClientMessage) => {
      // FR-008: replies-to-replies attach to the same parent. If the target
      // is itself a reply, surface its parent as the reply target so the
      // server doesn't need to rewrite anything.
      const root =
        target.parentMessageId &&
        stream.state.messages.find((m) => m.id === target.parentMessageId)
          ? stream.state.messages.find(
              (m) => m.id === target.parentMessageId
            ) ?? target
          : target;
      setReplyTo({
        messageId: root.id,
        authorName: root.author.displayName ?? "Member",
        snippet: (root.body ?? "").slice(0, 80),
      });
    },
    [stream.state.messages]
  );

  const handleToggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      const t = boot.thread;
      if (!t) return;
      const target = stream.state.messages.find((m) => m.id === messageId);
      // Optimistic delta: flip whatever the viewer's current state is.
      const currentlyReacted = target?.reactions.some(
        (r) => r.emoji === emoji && r.viewerReacted
      );
      const optimisticDelta = currentlyReacted ? "-1" : "+1";
      stream.applyReactionDelta({
        messageId,
        emoji,
        delta: optimisticDelta,
        actorId: viewer.id,
        actorDisplayName: viewer.displayName,
        isViewer: true,
      });
      // Fire and forget — the SSE echo will arrive later and is idempotent
      // (the reducer ignores `+1` duplicates from the same actor + emoji).
      fetch(
        `/api/threads/${t.id}/messages/${messageId}/reactions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji }),
        }
      )
        .then(async (res) => {
          if (res.ok) return;
          // Roll back the optimistic delta.
          stream.applyReactionDelta({
            messageId,
            emoji,
            delta: optimisticDelta === "+1" ? "-1" : "+1",
            actorId: viewer.id,
            actorDisplayName: viewer.displayName,
            isViewer: true,
          });
          if (res.status === 429) {
            toast.error(
              "Slow down — you're reacting faster than the room can keep up."
            );
          } else {
            toast.error("Couldn't toggle reaction. Try again.");
          }
        })
        .catch(() => {
          stream.applyReactionDelta({
            messageId,
            emoji,
            delta: optimisticDelta === "+1" ? "-1" : "+1",
            actorId: viewer.id,
            actorDisplayName: viewer.displayName,
            isViewer: true,
          });
          toast.error("Couldn't toggle reaction. Check your connection.");
        });
    },
    [boot.thread, stream, viewer.id, viewer.displayName]
  );

  // ---- Render --------------------------------------------------------------

  if (boot.status === "loading") {
    return (
      <div
        className="flex h-full flex-1 items-center justify-center"
        role="status"
        aria-label="Loading thread"
      >
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (boot.status === "error") {
    return (
      <div className="flex h-full flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {boot.error}
      </div>
    );
  }

  const thread = boot.thread;
  const messages = stream.state.messages;

  return (
    <div
      data-slot="thread-panel"
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col">
          <ThreadEmptyState />
        </div>
      ) : (
        <MessageList
          messages={messages}
          viewerId={viewer.id}
          members={bodyMembers}
          hasOlder={Boolean(stream.state.olderCursor)}
          loadingOlder={stream.state.loadingOlder}
          onLoadOlder={stream.loadOlderPage}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onReply={handleReply}
          onToggleReaction={handleToggleReaction}
          onJumpToMessage={jumpToMessage}
          highlightId={highlight.id}
          highlightToken={highlight.token}
        />
      )}
      <Composer
        threadId={thread.id}
        viewer={viewer}
        members={members}
        onAddOptimistic={stream.addOptimistic}
        onReconcile={stream.reconcileEcho}
        onMarkFailed={stream.markFailed}
        onDiscard={stream.discardOptimistic}
        failedTempId={failed?.clientTempId ?? null}
        failedBody={failed?.body ?? null}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
      />
    </div>
  );
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
