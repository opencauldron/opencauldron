"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, CornerUpRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { parseBody, type BodyMember } from "@/lib/threads/body-parse";
import { BodyRenderer } from "@/lib/threads/body-render";
import { MessageActionsMenu } from "./message-actions-menu";
import { ReactionRow } from "./reaction-row";
import { MessageAttachments } from "./attachment-renderers";
import type { ClientMessage } from "./types";

// ---------------------------------------------------------------------------
// Single message row (Phase 4 — expanded with reactions, reply badge,
// reply-chain affordance).
// ---------------------------------------------------------------------------

export interface MessageRowProps {
  message: ClientMessage;
  viewerId: string;
  members: BodyMember[];
  /**
   * Optional parent message — if `message.parentMessageId` is set and the
   * parent is currently in view, the caller passes it so we can render the
   * "Replying to <author>: <snippet>" badge.
   */
  parent?: ClientMessage | null;
  /**
   * Direct replies to *this* message (one level deep, FR-008). When non-empty
   * the row gains a collapsible "N replies" affordance. The caller computes
   * the children list once per panel re-render.
   */
  replies?: ClientMessage[];
  /** Show replies inline by default. Driven by the panel's state. */
  repliesExpanded?: boolean;
  onToggleReplies?: () => void;
  /**
   * Click-to-jump for the "Replying to X" badge. The panel scrolls + pulses
   * the parent row.
   */
  onJumpToParent?: (parentId: string) => void;
  onEdit: (
    messageId: string,
    body: string
  ) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (messageId: string) => Promise<{ ok: boolean; error?: string }>;
  onReply: (target: ClientMessage) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  /**
   * If set + matches `message.id`, the row pulses once to draw the eye
   * (deep-link, jump-to-parent, mention notification, etc).
   */
  highlightId?: string | null;
  /** Bumps every time the panel wants to retrigger the pulse. */
  highlightToken?: number;
  isViewerModerator?: boolean;
}

function MessageRowImpl({
  message,
  viewerId,
  members,
  parent,
  replies,
  repliesExpanded,
  onToggleReplies,
  onJumpToParent,
  onEdit,
  onDelete,
  onReply,
  onToggleReaction,
  highlightId,
  highlightToken,
  isViewerModerator = false,
}: MessageRowProps) {
  const isOwn = message.authorId === viewerId;
  const isDeleted = message.deletedAt !== null;
  const isPending = message.pendingState === "pending";
  const failed = message.pendingState === "failed";

  const [editing, setEditing] = useState(false);
  // One-shot pulse — bumped via `highlightToken` so re-arriving deep-links
  // can replay the animation.
  const [pulseKey, setPulseKey] = useState<number | null>(null);

  const rowRef = useRef<HTMLDivElement | null>(null);
  const isHighlighted = highlightId === message.id;
  useEffect(() => {
    if (!isHighlighted || !rowRef.current) return;
    rowRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    setPulseKey((highlightToken ?? 0) + 1);
  }, [isHighlighted, highlightToken]);

  const handleCopy = useCallback(() => {
    if (!message.body) return;
    navigator.clipboard
      .writeText(message.body)
      .then(() => toast.success("Copied"))
      .catch(() => toast.error("Couldn't copy."));
  }, [message.body]);

  return (
    <div
      ref={rowRef}
      role="article"
      data-slot="message-row"
      data-message-id={message.id}
      data-pending={isPending || undefined}
      data-failed={failed || undefined}
      className={cn(
        "group/message relative flex gap-3 rounded-lg px-3 py-2",
        "focus-within:bg-accent/40 hover:bg-accent/40",
        failed && "ring-1 ring-destructive/30",
        isPending && "opacity-70"
      )}
      aria-label={messageAriaLabel(message, isDeleted)}
    >
      {/* One-shot pulse layer — sits behind the row content. Re-keyed by
          `pulseKey` so the animation restarts on each highlight token bump. */}
      {pulseKey !== null ? (
        <span
          key={pulseKey}
          aria-hidden
          className="thread-highlight-pulse pointer-events-none absolute inset-0 rounded-lg"
        />
      ) : null}

      <Avatar size="sm" className="mt-0.5">
        {message.author.avatarUrl ? (
          <AvatarImage
            src={message.author.avatarUrl}
            alt={message.author.displayName ?? "Workspace member"}
          />
        ) : null}
        <AvatarFallback>
          {initials(message.author.displayName) ?? "?"}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        {/* Replying-to badge — renders when we have a known parent. We
            tap-to-jump to scroll the parent into view + pulse it. */}
        {parent ? (
          <ReplyingToBadge
            parent={parent}
            onJump={() => onJumpToParent?.(parent.id)}
          />
        ) : null}

        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {message.author.displayName ?? "Workspace member"}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatTimestamp(message.createdAt)}
          </span>
          {message.editedAt && !isDeleted ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    role="note"
                    tabIndex={0}
                    aria-label={`Edited ${formatTimestamp(message.editedAt)}`}
                    className="shrink-0 cursor-default rounded-sm text-[10px] uppercase tracking-wide text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  />
                }
              >
                (edited)
              </TooltipTrigger>
              <TooltipContent>
                Edited {formatTimestamp(message.editedAt)}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {isPending ? (
            <Loader2
              className="size-3 shrink-0 animate-spin text-muted-foreground"
              aria-label="Sending"
            />
          ) : null}
        </div>

        {isDeleted ? (
          <div className="mt-0.5 text-sm leading-relaxed">
            <span className="italic text-muted-foreground">
              This message was deleted
            </span>
          </div>
        ) : editing ? (
          <div className="mt-0.5 text-sm leading-relaxed text-foreground">
            <InlineEditor
              initialBody={message.body ?? ""}
              onCancel={() => setEditing(false)}
              onSave={async (next) => {
                const result = await onEdit(message.id, next);
                if (result.ok) setEditing(false);
                return result;
              }}
            />
          </div>
        ) : message.body && message.body.trim() ? (
          <div className="mt-0.5 text-sm leading-relaxed text-foreground">
            <RenderedBody body={message.body} members={members} />
          </div>
        ) : null}

        {/* Attachments (US3) — rendered after body, before reactions. The
            dispatcher splits `upload` (tile cluster) from `asset_ref` /
            `external_link` (full-width cards). Suppressed for tombstoned
            and editing rows so the user isn't editing around them. */}
        {!isDeleted && !editing && message.attachments.length > 0 ? (
          <MessageAttachments attachments={message.attachments} />
        ) : null}

        {/* Reactions — always rendered (even with zero reactions) when not
            deleted, so the hover trigger has somewhere to live. */}
        {!isDeleted && !editing ? (
          <ReactionRow
            reactions={message.reactions}
            onToggle={(emoji) => onToggleReaction(message.id, emoji)}
            canAddNew={!isPending}
          />
        ) : null}

        {/* Reply chain affordance (T041) — collapsed by default; expand
            shows a count; the panel renders the inline replies below. */}
        {replies && replies.length > 0 ? (
          <button
            type="button"
            onClick={() => onToggleReplies?.()}
            aria-expanded={repliesExpanded}
            className={cn(
              "mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium",
              "text-primary ring-1 ring-primary/20",
              "hover:bg-primary/10 active:translate-y-px"
            )}
          >
            {repliesExpanded ? (
              <ChevronDown aria-hidden className="size-3.5" />
            ) : (
              <ChevronRight aria-hidden className="size-3.5" />
            )}
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </button>
        ) : null}

        {failed && message.errorMessage ? (
          <p className="mt-1 text-xs text-destructive">
            {message.errorMessage}
          </p>
        ) : null}
      </div>

      {!isDeleted && !editing && !isPending ? (
        <div
          className={cn(
            "absolute right-2 top-2 opacity-0 transition-opacity",
            "group-hover/message:opacity-100 group-focus-within/message:opacity-100"
          )}
        >
          <MessageActionsMenu
            isOwnMessage={isOwn}
            canModerate={isViewerModerator}
            hasBody={Boolean(message.body)}
            onAddReaction={(emoji) => onToggleReaction(message.id, emoji)}
            onReply={() => onReply(message)}
            onCopy={handleCopy}
            onEdit={() => setEditing(true)}
            onDelete={() => onDelete(message.id)}
          />
        </div>
      ) : null}
    </div>
  );
}

export const MessageRow = memo(MessageRowImpl);

// ---------------------------------------------------------------------------
// Replying-to badge (T040) — sits above the message body. Tap-to-jump scrolls
// the parent into view (handled by the panel) and triggers a pulse there.
// ---------------------------------------------------------------------------

function ReplyingToBadge({
  parent,
  onJump,
}: {
  parent: ClientMessage;
  onJump: () => void;
}) {
  const snippet = (parent.body ?? "").slice(0, 80);
  const authorName = parent.author.displayName ?? "Member";
  const isDeletedParent = parent.deletedAt !== null;
  return (
    <button
      type="button"
      onClick={onJump}
      aria-label={`Jump to ${authorName}'s message`}
      className={cn(
        "mb-1 inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs",
        "bg-accent/40 text-muted-foreground ring-1 ring-foreground/5",
        "hover:bg-accent/60 active:translate-y-px"
      )}
    >
      <CornerUpRight aria-hidden className="size-3 text-muted-foreground" />
      <span className="font-medium text-foreground">{authorName}</span>
      <span className="truncate text-muted-foreground">
        {isDeletedParent ? "deleted message" : snippet || "(empty)"}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function RenderedBody({
  body,
  members,
}: {
  body: string | null;
  members: BodyMember[];
}) {
  // Suppress whitespace-only bodies — the composer sends a single " " for
  // attachment-only messages so the server's `min(1)` schema passes; we
  // don't want to paint a stray blank paragraph above the attachment cluster.
  if (!body || !body.trim()) return null;
  const parsed = parseBody(body, members);
  return <BodyRenderer nodes={parsed.structuredBody} />;
}

function InlineEditor({
  initialBody,
  onCancel,
  onSave,
}: {
  initialBody: string;
  onCancel: () => void;
  onSave: (body: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [value, setValue] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.setSelectionRange(value.length, value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === initialBody.trim()) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    const result = await onSave(trimmed);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't save your edit. Try again.");
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
            return;
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={Math.min(8, Math.max(2, value.split("\n").length))}
        disabled={saving}
        aria-label="Edit message"
        className={cn(
          "w-full resize-none rounded-md bg-background px-3 py-2 text-sm leading-relaxed",
          "ring-1 ring-foreground/10 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        )}
      />
      <div className="flex items-center gap-2">
        <Button size="xs" onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save
        </Button>
        <Button size="xs" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          ⌘↵ to save · Esc to cancel
        </span>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function initials(name: string | null): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || null;
}

function formatTimestamp(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (diffMs < 60_000) return "just now";
  if (sameDay) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function messageAriaLabel(message: ClientMessage, isDeleted: boolean): string {
  if (isDeleted) {
    return `${message.author.displayName ?? "Member"} deleted a message.`;
  }
  const ts = formatTimestamp(message.createdAt);
  const body = (message.body ?? "").slice(0, 120);
  return `${message.author.displayName ?? "Member"} at ${ts}: ${body}`;
}
