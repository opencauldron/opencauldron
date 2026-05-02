"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ClientMessage } from "./types";

// ---------------------------------------------------------------------------
// Reducer + EventSource hook for the live thread surface (T028).
//
// Flow:
//   1. Caller seeds the initial snapshot via `setInitialMessages` (called once
//      when `GET /api/threads/by-asset/<id>` resolves).
//   2. Hook opens an EventSource on `/api/threads/<id>/stream`.
//   3. On `open`, hook GETs `/api/threads/<id>/messages?since=<lastSeenAt>`
//      to backfill any messages posted while disconnected (FR-012 resync).
//   4. On `message.created` / `message.updated` / `message.deleted` events:
//      hook fetches the canonical message JSON via the messages list endpoint
//      and dispatches into the reducer. We don't trust the wire payload to
//      include the full row — `pg_notify` payloads cap at 8000 bytes per the
//      plan; the event carries metadata only.
//   5. On the server's proactive `reconnect` event (~4:30 inside Vercel's
//      5-min window): close + reopen the EventSource. The browser's native
//      auto-reconnect handles network drops separately.
//
// Optimistic sends:
//   `addOptimistic` inserts a `pendingState: "pending"` message keyed by
//   `clientTempId`. When the POST resolves, `reconcileEcho` swaps in the
//   server's row using the same key. On failure, `markFailed` flips the
//   pending row to `"failed"` with an error message.
// ---------------------------------------------------------------------------

export interface ThreadStreamState {
  messages: ClientMessage[];
  /** Cursor for the older-page (returned by GET `?cursor=...`). */
  olderCursor: string | null;
  /** Whether the older page is currently loading (sentinel intersected). */
  loadingOlder: boolean;
  /**
   * The last `created_at` we've seen — used by the on-open resync request.
   * `null` until any message is rendered.
   */
  lastSeenAt: string | null;
  /** SSE connection status — surfaced as a low-key indicator in the UI. */
  connection: "idle" | "open" | "reconnecting" | "error";
}

/**
 * Single reaction delta — applied directly to a message's `reactions` array
 * without a canonical refetch. The `pg_notify` payload carries the
 * `(messageId, emoji, actorId, delta)` 4-tuple, which is everything the
 * reducer needs.
 *
 * `actorDisplayName` is derived best-effort from messages-in-view (workspace
 * roster); falls back to "Someone" when the actor isn't represented locally.
 */
export interface ReactionDelta {
  messageId: string;
  emoji: string;
  delta: "+1" | "-1";
  actorId: string;
  actorDisplayName: string | null;
  /** Whether the viewer is the actor (drives `viewerReacted`). */
  isViewer: boolean;
}

type Action =
  | { type: "set_initial"; messages: ClientMessage[]; olderCursor: string | null }
  | { type: "add_optimistic"; message: ClientMessage }
  | { type: "reconcile_echo"; clientTempId: string; serverMessage: ClientMessage }
  | { type: "mark_failed"; clientTempId: string; error: string }
  | { type: "discard_optimistic"; clientTempId: string }
  | { type: "merge_messages"; messages: ClientMessage[] }
  | { type: "remove_message"; messageId: string }
  | { type: "soft_delete"; messageId: string; deletedAt: string }
  | { type: "prepend_older"; messages: ClientMessage[]; nextCursor: string | null }
  | { type: "older_loading"; loading: boolean }
  | { type: "set_connection"; connection: ThreadStreamState["connection"] }
  | { type: "apply_reaction_deltas"; deltas: ReactionDelta[] };

function compareMessages(a: ClientMessage, b: ClientMessage): number {
  // Order: createdAt asc, id asc (matches the server's tiebreak rule).
  // Optimistic locals get sorted by their own `createdAt` (set client-side
  // to roughly "now") and reconciled to server time on echo.
  const at = new Date(a.createdAt).getTime();
  const bt = new Date(b.createdAt).getTime();
  if (at !== bt) return at - bt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function reducer(state: ThreadStreamState, action: Action): ThreadStreamState {
  switch (action.type) {
    case "set_initial": {
      const next = action.messages.slice().sort(compareMessages);
      return {
        ...state,
        messages: next,
        olderCursor: action.olderCursor,
        lastSeenAt: next.length ? next[next.length - 1].createdAt : null,
      };
    }
    case "add_optimistic": {
      // Don't dedupe by id (optimistic id is the temp id, never collides) —
      // just append + sort.
      const next = [...state.messages, action.message].sort(compareMessages);
      return { ...state, messages: next };
    }
    case "reconcile_echo": {
      const idx = state.messages.findIndex(
        (m) => m.clientTempId === action.clientTempId
      );
      if (idx < 0) {
        // Echo arrived before the optimistic insert was committed — merge it
        // by id instead. (Race: server pushes the SSE event faster than our
        // POST returns.)
        return reducer(state, {
          type: "merge_messages",
          messages: [action.serverMessage],
        });
      }
      const next = state.messages.slice();
      next[idx] = {
        ...action.serverMessage,
        // Preserve the temp id so a subsequent stream event for the same
        // message can still reconcile by it during the window where both keys
        // coexist client-side.
        clientTempId: action.clientTempId,
        pendingState: undefined,
      };
      next.sort(compareMessages);
      const lastSeen = next[next.length - 1]?.createdAt ?? state.lastSeenAt;
      return { ...state, messages: next, lastSeenAt: lastSeen };
    }
    case "mark_failed": {
      const idx = state.messages.findIndex(
        (m) => m.clientTempId === action.clientTempId
      );
      if (idx < 0) return state;
      const next = state.messages.slice();
      next[idx] = {
        ...next[idx],
        pendingState: "failed",
        errorMessage: action.error,
      };
      return { ...state, messages: next };
    }
    case "discard_optimistic": {
      const next = state.messages.filter(
        (m) => m.clientTempId !== action.clientTempId
      );
      return { ...state, messages: next };
    }
    case "merge_messages": {
      // Upsert by id; preserve any optimistic flags if the row exists.
      const byId = new Map(state.messages.map((m) => [m.id, m]));
      for (const m of action.messages) {
        const existing = byId.get(m.id);
        byId.set(m.id, existing ? { ...existing, ...m } : m);
      }
      const next = Array.from(byId.values()).sort(compareMessages);
      const lastSeen = next[next.length - 1]?.createdAt ?? state.lastSeenAt;
      return { ...state, messages: next, lastSeenAt: lastSeen };
    }
    case "remove_message": {
      const next = state.messages.filter((m) => m.id !== action.messageId);
      return { ...state, messages: next };
    }
    case "soft_delete": {
      const next = state.messages.map((m) =>
        m.id === action.messageId
          ? { ...m, body: null, deletedAt: action.deletedAt }
          : m
      );
      return { ...state, messages: next };
    }
    case "prepend_older": {
      // Older page comes back oldest-first. Dedupe by id in case the cursor
      // overlapped with what's already loaded.
      const existingIds = new Set(state.messages.map((m) => m.id));
      const fresh = action.messages.filter((m) => !existingIds.has(m.id));
      const next = [...fresh, ...state.messages].sort(compareMessages);
      return {
        ...state,
        messages: next,
        olderCursor: action.nextCursor,
        loadingOlder: false,
      };
    }
    case "older_loading":
      return { ...state, loadingOlder: action.loading };
    case "set_connection":
      return { ...state, connection: action.connection };
    case "apply_reaction_deltas": {
      // Group deltas by messageId so we touch each affected message exactly
      // once. Within a frame, multiple deltas targeting the same message
      // collapse via the loop's incremental updates.
      const byMsg = new Map<string, ReactionDelta[]>();
      for (const d of action.deltas) {
        const arr = byMsg.get(d.messageId);
        if (arr) arr.push(d);
        else byMsg.set(d.messageId, [d]);
      }
      let mutated = false;
      const next = state.messages.map((m) => {
        const deltas = byMsg.get(m.id);
        if (!deltas) return m;
        mutated = true;
        return { ...m, reactions: applyReactionDeltas(m.reactions, deltas) };
      });
      if (!mutated) return state;
      return { ...state, messages: next };
    }
  }
}

/**
 * Pure-functional reaction-delta apply. Returns a new reactions array.
 *   - `+1` for an emoji that doesn't exist yet → new chip with count=1.
 *   - `+1` for an existing emoji where the actor isn't already a reactor →
 *     count+=1, push to reactors (capped at 8 like the server hydrator).
 *   - `-1` for an existing emoji → decrement count, drop the actor from
 *     reactors. If count hits 0, drop the chip entirely.
 *
 * Idempotency: a duplicate `+1` for the same `(emoji, actorId)` is a no-op,
 * which keeps echoed events safe (server's POST returns its own delta AND
 * fires NOTIFY — without idempotency the actor's own toggle would
 * double-count).
 *
 * Exported so unit tests can exercise the algorithm without spinning up a
 * reducer + hook harness.
 */
export function applyReactionDeltas(
  current: ClientMessage["reactions"],
  deltas: ReactionDelta[]
): ClientMessage["reactions"] {
  // Operate on a mutable copy keyed by emoji.
  type Reaction = ClientMessage["reactions"][number];
  const byEmoji = new Map<string, Reaction>(current.map((r) => [r.emoji, { ...r, reactors: r.reactors.slice() }]));
  for (const d of deltas) {
    const existing = byEmoji.get(d.emoji);
    if (d.delta === "+1") {
      if (!existing) {
        byEmoji.set(d.emoji, {
          emoji: d.emoji,
          count: 1,
          reactors: [{ userId: d.actorId, displayName: d.actorDisplayName }],
          viewerReacted: d.isViewer,
        });
      } else if (!existing.reactors.some((r) => r.userId === d.actorId)) {
        existing.count += 1;
        if (existing.reactors.length < 8) {
          existing.reactors.push({
            userId: d.actorId,
            displayName: d.actorDisplayName,
          });
        }
        if (d.isViewer) existing.viewerReacted = true;
      }
    } else {
      if (!existing) continue;
      // Idempotency: if the truncated reactors list doesn't carry the actor
      // BUT the count is still > reactors.length, we can't tell whether the
      // actor was actually reacting (the server caps reactors at 8). In
      // that ambiguous case, decrement the count and skip the reactors
      // mutation. Conservative — but matches the server's behavior on its
      // own DELETE response, which always returns ok+removed regardless of
      // the truncation window.
      const wasInVisibleReactors = existing.reactors.some(
        (r) => r.userId === d.actorId
      );
      const couldBeTruncated = existing.count > existing.reactors.length;
      if (!wasInVisibleReactors && !couldBeTruncated) continue;
      existing.count = Math.max(0, existing.count - 1);
      existing.reactors = existing.reactors.filter(
        (r) => r.userId !== d.actorId
      );
      if (d.isViewer) existing.viewerReacted = false;
      if (existing.count === 0) byEmoji.delete(d.emoji);
    }
  }
  // Re-sort: most-reacted first; tie-break alphabetically (matches server
  // hydrator).
  return Array.from(byEmoji.values()).sort(
    (a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji)
  );
}

const initialState: ThreadStreamState = {
  messages: [],
  olderCursor: null,
  loadingOlder: false,
  lastSeenAt: null,
  connection: "idle",
};

export interface UseThreadStreamArgs {
  threadId: string | null;
  enabled: boolean;
  /**
   * Viewer info — used to mark `viewerReacted` correctly when an SSE
   * `reaction.toggled` event matches the viewer's own actorId.
   */
  viewerId: string;
  /**
   * Optional resolver for actor display name when applying a reaction delta.
   * The picker passes the workspace member roster; if undefined, the actor
   * gets `displayName: null` and the tooltip falls back to "Someone".
   */
  resolveDisplayName?: (userId: string) => string | null;
}

export interface UseThreadStreamReturn {
  state: ThreadStreamState;
  setInitial: (messages: ClientMessage[], olderCursor: string | null) => void;
  addOptimistic: (message: ClientMessage) => void;
  reconcileEcho: (clientTempId: string, serverMessage: ClientMessage) => void;
  markFailed: (clientTempId: string, error: string) => void;
  discardOptimistic: (clientTempId: string) => void;
  loadOlderPage: () => Promise<void>;
  applyLocalDelete: (messageId: string) => void;
  applyLocalEdit: (message: ClientMessage) => void;
  /**
   * Apply an immediate reaction delta — used for optimistic toggles before
   * the server's NOTIFY round-trips back. Idempotent: a duplicate `+1` for
   * the same `(emoji, actorId)` is a no-op, so the echoed SSE event lands
   * harmlessly.
   */
  applyReactionDelta: (delta: ReactionDelta) => void;
}

export function useThreadStream({
  threadId,
  enabled,
  viewerId,
  resolveDisplayName,
}: UseThreadStreamArgs): UseThreadStreamReturn {
  const [state, dispatch] = useReducer(reducer, initialState);

  // We hold the latest state in a ref so the SSE event handler — which is
  // long-lived — can read up-to-date values without re-subscribing on every
  // render. Update inside `useEffect` to satisfy `react-hooks/refs`
  // (mutating a ref during render is forbidden in React 19).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // ---------------------------------------------------------------------------
  // Imperative API
  // ---------------------------------------------------------------------------

  const setInitial = useCallback(
    (messages: ClientMessage[], olderCursor: string | null) => {
      dispatch({ type: "set_initial", messages, olderCursor });
    },
    []
  );

  const addOptimistic = useCallback((message: ClientMessage) => {
    dispatch({ type: "add_optimistic", message });
  }, []);

  const reconcileEcho = useCallback(
    (clientTempId: string, serverMessage: ClientMessage) => {
      dispatch({ type: "reconcile_echo", clientTempId, serverMessage });
    },
    []
  );

  const markFailed = useCallback((clientTempId: string, error: string) => {
    dispatch({ type: "mark_failed", clientTempId, error });
  }, []);

  const discardOptimistic = useCallback((clientTempId: string) => {
    dispatch({ type: "discard_optimistic", clientTempId });
  }, []);

  const applyLocalDelete = useCallback((messageId: string) => {
    dispatch({
      type: "soft_delete",
      messageId,
      deletedAt: new Date().toISOString(),
    });
  }, []);

  const applyLocalEdit = useCallback((message: ClientMessage) => {
    dispatch({ type: "merge_messages", messages: [message] });
  }, []);

  const applyReactionDelta = useCallback((delta: ReactionDelta) => {
    dispatch({ type: "apply_reaction_deltas", deltas: [delta] });
  }, []);

  // Hold the resolver in a ref so the SSE listener doesn't re-bind when the
  // member roster updates upstream.
  const resolveDisplayNameRef = useRef(resolveDisplayName);
  useEffect(() => {
    resolveDisplayNameRef.current = resolveDisplayName;
  }, [resolveDisplayName]);

  const loadOlderPage = useCallback(async () => {
    if (!threadId) return;
    const cursor = stateRef.current.olderCursor;
    if (!cursor || stateRef.current.loadingOlder) return;
    dispatch({ type: "older_loading", loading: true });
    try {
      const res = await fetch(
        `/api/threads/${threadId}/messages?cursor=${encodeURIComponent(cursor)}`
      );
      if (!res.ok) {
        dispatch({ type: "older_loading", loading: false });
        return;
      }
      const json = (await res.json()) as {
        messages: ClientMessage[];
        nextCursor: string | null;
      };
      dispatch({
        type: "prepend_older",
        messages: json.messages,
        nextCursor: json.nextCursor,
      });
    } catch {
      dispatch({ type: "older_loading", loading: false });
    }
  }, [threadId]);

  // ---------------------------------------------------------------------------
  // EventSource lifecycle — gated behind `enabled` so callers can hold the
  // hook stable through threadless states (panel open before fetch resolves).
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!enabled || !threadId || typeof window === "undefined") return;

    let es: EventSource | null = null;
    let aborted = false;

    // ---- Reaction-event coalescing buffer ----------------------------------
    // Multiple `reaction.toggled` events arriving in the same animation frame
    // collapse into a single `apply_reaction_deltas` dispatch. This is the
    // hot path under thundering-herd load (50 viewers reacting to the same
    // message) — without coalescing the reducer runs N times per frame.
    let reactionBuffer: ReactionDelta[] = [];
    let rafScheduled = 0;
    const flushReactions = () => {
      rafScheduled = 0;
      if (reactionBuffer.length === 0) return;
      const deltas = reactionBuffer;
      reactionBuffer = [];
      dispatch({ type: "apply_reaction_deltas", deltas });
    };
    const queueReaction = (delta: ReactionDelta) => {
      reactionBuffer.push(delta);
      if (rafScheduled) return;
      rafScheduled = window.requestAnimationFrame(flushReactions);
    };

    const fetchSince = async () => {
      const since = stateRef.current.lastSeenAt;
      if (!since) return;
      try {
        const res = await fetch(
          `/api/threads/${threadId}/messages?since=${encodeURIComponent(since)}`
        );
        if (!res.ok) return;
        const json = (await res.json()) as { messages: ClientMessage[] };
        if (json.messages.length > 0) {
          dispatch({ type: "merge_messages", messages: json.messages });
        }
      } catch {
        // Resync best-effort; the next event will retrigger.
      }
    };

    const fetchSingleMessage = async (messageId: string) => {
      // Cheap path: the messages list endpoint with a tight `since` window —
      // if the message is newer than `lastSeenAt`, it'll come back. If it's
      // an edit/delete to an older message, the resync window won't catch it,
      // so we fall back to a `?since=<id-1ms>` hack — but the simplest
      // solution is `?since=<oldest-message-createdAt>` which always works.
      const candidate =
        stateRef.current.messages.find((m) => m.id === messageId)?.createdAt ??
        stateRef.current.lastSeenAt;
      if (!candidate) return;
      const sinceParam = new Date(
        new Date(candidate).getTime() - 1
      ).toISOString();
      try {
        const res = await fetch(
          `/api/threads/${threadId}/messages?since=${encodeURIComponent(sinceParam)}`
        );
        if (!res.ok) return;
        const json = (await res.json()) as { messages: ClientMessage[] };
        const target = json.messages.find((m) => m.id === messageId);
        if (target) {
          dispatch({ type: "merge_messages", messages: [target] });
        }
      } catch {
        // Best-effort.
      }
    };

    const open = () => {
      if (aborted) return;
      es = new EventSource(`/api/threads/${threadId}/stream`);

      es.addEventListener("open", () => {
        dispatch({ type: "set_connection", connection: "open" });
        // Backfill anything missed during the disconnect window.
        fetchSince();
      });

      es.addEventListener("error", () => {
        // The browser auto-reconnects EventSource by default. We just flag
        // the UI so the indicator can dim.
        dispatch({ type: "set_connection", connection: "reconnecting" });
      });

      es.addEventListener("message.created", (ev) => {
        const data = parseEvent(ev as MessageEvent);
        if (!data?.messageId) return;
        fetchSingleMessage(data.messageId);
      });

      es.addEventListener("message.updated", (ev) => {
        const data = parseEvent(ev as MessageEvent);
        if (!data?.messageId) return;
        fetchSingleMessage(data.messageId);
      });

      es.addEventListener("message.deleted", (ev) => {
        const data = parseEvent(ev as MessageEvent);
        if (!data?.messageId) return;
        // Soft-delete locally — the canonical fetch would also work but
        // saves a round trip for a known shape.
        dispatch({
          type: "soft_delete",
          messageId: data.messageId,
          deletedAt: new Date().toISOString(),
        });
      });

      es.addEventListener("reaction.toggled", (ev) => {
        const data = parseEvent(ev as MessageEvent);
        if (
          !data?.messageId ||
          !data.emoji ||
          !data.actorId ||
          (data.delta !== "+1" && data.delta !== "-1")
        ) {
          return;
        }
        queueReaction({
          messageId: data.messageId,
          emoji: data.emoji,
          delta: data.delta,
          actorId: data.actorId,
          actorDisplayName:
            resolveDisplayNameRef.current?.(data.actorId) ?? null,
          isViewer: data.actorId === viewerId,
        });
      });

      es.addEventListener("reconnect", () => {
        // Server is about to tear us down (Vercel timeout). Pre-emptively
        // close + reopen so the browser doesn't see an `error` event.
        es?.close();
        if (aborted) return;
        dispatch({ type: "set_connection", connection: "reconnecting" });
        // Tiny delay so the browser doesn't open a connection that the
        // server is still in the process of closing.
        setTimeout(open, 50);
      });
    };

    open();

    return () => {
      aborted = true;
      if (rafScheduled) window.cancelAnimationFrame(rafScheduled);
      reactionBuffer = [];
      es?.close();
      dispatch({ type: "set_connection", connection: "idle" });
    };
  }, [enabled, threadId, viewerId]);

  return {
    state,
    setInitial,
    addOptimistic,
    reconcileEcho,
    markFailed,
    discardOptimistic,
    loadOlderPage,
    applyLocalDelete,
    applyLocalEdit,
    applyReactionDelta,
  };
}

interface SseEventData {
  messageId?: string;
  emoji?: string;
  delta?: "+1" | "-1";
  actorId?: string;
}

function parseEvent(ev: MessageEvent): SseEventData | null {
  try {
    return JSON.parse(ev.data) as SseEventData;
  } catch {
    return null;
  }
}
