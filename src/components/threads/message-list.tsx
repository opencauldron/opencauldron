"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BodyMember } from "@/lib/threads/body-parse";
import { MessageRow } from "./message-row";
import type { ClientMessage } from "./types";

// ---------------------------------------------------------------------------
// Vertical message list (Phase 4 — adds parent + replies wiring).
//
// Messages render flat in the timeline (chat order: oldest at top, newest
// at bottom). Parent + reply relationships are surfaced two ways:
//   * Each reply's row carries a "Replying to X" badge above its body.
//   * Parents with replies get a "N replies" affordance that scrolls to the
//     first reply and pulses it.
// ---------------------------------------------------------------------------

export interface MessageListProps {
  messages: ClientMessage[];
  viewerId: string;
  members: BodyMember[];
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onEdit: (
    messageId: string,
    body: string
  ) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (messageId: string) => Promise<{ ok: boolean; error?: string }>;
  onReply: (target: ClientMessage) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  /**
   * Highlight a message: scroll into view + pulse. The token bumps when the
   * panel wants to retrigger the same message id (e.g. user clicks a reply
   * badge twice).
   */
  highlightId?: string | null;
  highlightToken?: number;
  isViewerModerator?: boolean;
  /** Click-to-jump for the "Replying to X" badge. Scrolls + pulses. */
  onJumpToMessage?: (messageId: string) => void;
  /** Click-to-jump for the parent's "N replies" affordance. */
  onToggleReplies?: (parentId: string) => void;
}

export function MessageList({
  messages,
  viewerId,
  members,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onEdit,
  onDelete,
  onReply,
  onToggleReaction,
  highlightId,
  highlightToken,
  isViewerModerator,
  onJumpToMessage,
  onToggleReplies,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const wasAtBottomRef = useRef(true);
  const prevHeightRef = useRef<number | null>(null);
  const prevTopMessageIdRef = useRef<string | null>(null);

  // ---- Build parent + replies maps once per messages-array identity --------
  const { byId, repliesByParent } = useMemo(() => {
    const idMap = new Map<string, ClientMessage>();
    const replies = new Map<string, ClientMessage[]>();
    for (const m of messages) {
      idMap.set(m.id, m);
    }
    for (const m of messages) {
      if (!m.parentMessageId) continue;
      const arr = replies.get(m.parentMessageId);
      if (arr) arr.push(m);
      else replies.set(m.parentMessageId, [m]);
    }
    return { byId: idMap, repliesByParent: replies };
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      wasAtBottomRef.current = distanceFromBottom < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !hasOlder) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onLoadOlder();
            return;
          }
        }
      },
      { root, rootMargin: "120px 0px 0px 0px", threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasOlder, onLoadOlder]);

  const firstMessageId = messages[0]?.id ?? null;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (
      prevHeightRef.current !== null &&
      prevTopMessageIdRef.current &&
      firstMessageId !== prevTopMessageIdRef.current
    ) {
      const delta = el.scrollHeight - prevHeightRef.current;
      if (delta > 0) el.scrollTop += delta;
    }
    prevHeightRef.current = el.scrollHeight;
    prevTopMessageIdRef.current = firstMessageId;
  }, [firstMessageId, messages.length]);

  const lastMessageId = messages[messages.length - 1]?.id ?? null;
  const lastMessageIdRef = useRef<string | null>(null);
  // Compact text the announcer region reads when a new message lands. Skips
  // the very first render so the SR doesn't dump the entire backlog. The
  // pattern below (previous-prop tracked in state, render-time guarded
  // setState) is React 19's canonical recipe — see
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [announcement, setAnnouncement] = useState<string>("");
  const ANN_INIT = "__init__";
  const [seenLastId, setSeenLastId] = useState<string | null>(ANN_INIT);
  if (lastMessageId && seenLastId !== lastMessageId) {
    setSeenLastId(lastMessageId);
    if (seenLastId !== ANN_INIT) {
      const m = messages[messages.length - 1];
      if (m && !m.deletedAt) {
        const author = m.author?.displayName ?? "A workspace member";
        const snippet = (m.body ?? "").trim().slice(0, 120);
        setAnnouncement(
          snippet
            ? `${author} said: ${snippet}`
            : `${author} sent an attachment`
        );
      }
    }
  }
  useEffect(() => {
    if (lastMessageId === lastMessageIdRef.current) return;
    const isFirstRender = lastMessageIdRef.current === null;
    lastMessageIdRef.current = lastMessageId;
    const el = scrollRef.current;
    if (!el || !lastMessageId) return;
    if (isFirstRender || wasAtBottomRef.current) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [lastMessageId]);

  return (
    <div
      ref={scrollRef}
      data-slot="thread-message-list"
      className={cn(
        "flex-1 overflow-y-auto px-1 py-3",
        messages.length > 3 &&
          "[mask-image:linear-gradient(to_bottom,transparent,black_24px,black_calc(100%-12px),transparent)]"
      )}
    >
      {hasOlder ? (
        <div
          ref={sentinelRef}
          className="flex h-8 items-center justify-center text-xs text-muted-foreground"
          aria-hidden={!loadingOlder}
        >
          {loadingOlder ? (
            <Loader2
              className="size-3.5 animate-spin"
              aria-label="Loading older messages"
            />
          ) : null}
        </div>
      ) : null}

      {/* Offscreen announcer — fires only on new-message arrivals (post-
          first-render) and reads "<author> said: <snippet>". Lighter for
          screen readers than aria-live on the whole <ul>, which made every
          re-render dump the entire row's nested chrome. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <ul
        role="log"
        aria-label="Thread messages"
        className="flex flex-col gap-0.5"
      >
        {messages.map((m) => {
          const parent = m.parentMessageId
            ? byId.get(m.parentMessageId) ?? null
            : null;
          const ownReplies = repliesByParent.get(m.id);
          // Treat the "N replies" affordance as jump-to-first-reply for v1.
          // Toggle handler: bump the highlight on the first reply.
          const handleToggleReplies = ownReplies
            ? () => {
                if (onToggleReplies) onToggleReplies(m.id);
                else if (onJumpToMessage)
                  onJumpToMessage(ownReplies[0].id);
              }
            : undefined;
          return (
            <li key={m.clientTempId ?? m.id} className="list-none">
              <MessageRow
                message={m}
                viewerId={viewerId}
                members={members}
                parent={parent}
                replies={ownReplies}
                repliesExpanded
                onToggleReplies={handleToggleReplies}
                onJumpToParent={onJumpToMessage}
                onEdit={onEdit}
                onDelete={onDelete}
                onReply={onReply}
                onToggleReaction={onToggleReaction}
                highlightId={highlightId}
                highlightToken={highlightToken}
                isViewerModerator={isViewerModerator}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
