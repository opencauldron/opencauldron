"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import {
  CornerUpRight,
  Image as ImageIcon,
  Library,
  Loader2,
  RefreshCcw,
  Send,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  extractActiveMention,
  filterMembers,
  MentionTypeahead,
  type MentionMember,
} from "./mention-typeahead";
import { ComposerAttachmentTile } from "./composer-attachment-tile";
import { LibraryAssetPickerDialog } from "./library-asset-picker-dialog";
import {
  MAX_ATTACHMENTS,
  useComposerAttachments,
} from "./use-composer-attachments";
import type { ClientMessage, ClientMessageAttachment } from "./types";

// ---------------------------------------------------------------------------
// Composer (T031 + T038 + T039 + T045 + T050).
//
// Markdown-lite hint, ⌘/Ctrl+Enter sends, Enter inserts a newline.
//
// Phase 5 additions:
//   * Paste-handler + drag-handler intercept image/gif/video drops and route
//     them through `useComposerAttachments` for queue + per-attachment upload.
//   * "Attach from Library" button opens `<LibraryAssetPickerDialog>` and
//     enqueues the chosen asset as an `asset_ref`.
//   * Send is gated on `hasUnresolved` so a user can't fire a message while
//     uploads are still racing.
// ---------------------------------------------------------------------------

export interface ReplyTarget {
  messageId: string;
  authorName: string;
  snippet: string;
}

export interface ComposerProps {
  threadId: string;
  viewer: {
    id: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  /** Workspace member roster for the mention typeahead. Cached at panel level. */
  members: MentionMember[];
  /**
   * Append the optimistic message to the list. Parent uses the message's
   * `clientTempId` to reconcile the server echo.
   */
  onAddOptimistic: (message: ClientMessage) => void;
  onReconcile: (clientTempId: string, server: ClientMessage) => void;
  onMarkFailed: (clientTempId: string, error: string) => void;
  onDiscard: (clientTempId: string) => void;
  /** Last failed clientTempId, if any — surfaces a retry banner. */
  failedTempId?: string | null;
  failedBody?: string | null;
  /** Reply target — set by clicking Reply on a message. Null clears. */
  replyTo?: ReplyTarget | null;
  onClearReply?: () => void;
}

const MAX_BODY_LEN = 4000;

interface ActiveMention {
  start: number;
  query: string;
}

export function Composer({
  threadId,
  viewer,
  members,
  onAddOptimistic,
  onReconcile,
  onMarkFailed,
  onDiscard,
  failedTempId,
  failedBody,
  replyTo,
  onClearReply,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [activeMention, setActiveMention] = useState<ActiveMention | null>(
    null
  );
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();

  const attach = useComposerAttachments({ threadId });

  const filteredMembers = useMemo(
    () => (activeMention ? filterMembers(members, activeMention.query) : []),
    [activeMention, members]
  );

  // ---- Send ---------------------------------------------------------------
  const send = useCallback(
    async (rawBody: string, retryTempId?: string) => {
      const body = rawBody.trim();
      const serverAttachments = attach.toServerPayload();
      const hasAttachments = serverAttachments.length > 0;
      // Allow attachment-only messages: empty body is fine if attachments exist.
      if (!body && !hasAttachments) return;
      if (body.length > MAX_BODY_LEN) return;
      if (attach.hasUnresolved) {
        toast.error("Hold on — an attachment is still uploading.");
        return;
      }

      const clientTempId = retryTempId ?? crypto.randomUUID();
      const parentMessageId = replyTo?.messageId ?? null;
      // Optimistic-shape attachments — just enough so the row renders the
      // upload tile cluster pre-echo. The server echo carries the canonical
      // ids and replaces these on reconcile.
      const optimisticAttachments: ClientMessageAttachment[] =
        serverAttachments.map((a, i) => {
          if (a.kind === "upload") {
            return {
              id: `temp-att-${clientTempId}-${i}`,
              kind: "upload",
              r2Key: a.r2Key,
              r2Url: a.r2Url,
              mimeType: a.mimeType,
              fileSize: a.fileSize,
              width: a.width,
              height: a.height,
              assetId: null,
              url: null,
              displayName: a.displayName,
              position: i,
            };
          }
          return {
            id: `temp-att-${clientTempId}-${i}`,
            kind: "asset_ref",
            r2Key: null,
            r2Url: null,
            mimeType: null,
            fileSize: null,
            width: null,
            height: null,
            assetId: a.assetId,
            url: null,
            displayName: a.displayName,
            position: i,
          };
        });
      const optimistic: ClientMessage = {
        id: `temp-${clientTempId}`,
        threadId,
        workspaceId: "",
        authorId: viewer.id,
        parentMessageId,
        body: body || null,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        attachments: optimisticAttachments,
        reactions: [],
        mentions: [],
        author: {
          id: viewer.id,
          displayName: viewer.displayName,
          avatarUrl: viewer.avatarUrl,
        },
        clientTempId,
        pendingState: "pending",
      };

      if (retryTempId) onDiscard(retryTempId);
      onAddOptimistic(optimistic);

      if (!retryTempId) {
        setValue("");
        setActiveMention(null);
        attach.clear();
        onClearReply?.();
        requestAnimationFrame(() => textareaRef.current?.focus());
      }

      setSending(true);
      try {
        const res = await fetch(`/api/threads/${threadId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Server-side zod schema requires a non-empty body. For attachment-
            // only messages, send a single space — the renderer suppresses
            // whitespace-only bodies and only the attachments will paint.
            body: body || " ",
            clientTempId,
            parentMessageId,
            attachments: serverAttachments,
          }),
        });
        if (!res.ok) {
          const text = await safeReadError(res);
          onMarkFailed(clientTempId, text);
          return;
        }
        const json = (await res.json()) as { message: ClientMessage };
        onReconcile(clientTempId, json.message);
      } catch {
        onMarkFailed(
          clientTempId,
          "Couldn't send — check your connection and try again."
        );
      } finally {
        setSending(false);
      }
    },
    [
      threadId,
      viewer.id,
      viewer.displayName,
      viewer.avatarUrl,
      replyTo?.messageId,
      attach,
      onAddOptimistic,
      onDiscard,
      onMarkFailed,
      onReconcile,
      onClearReply,
    ]
  );

  // ---- Mention typeahead --------------------------------------------------
  const recomputeMention = useCallback((next: string, caret: number) => {
    const detected = extractActiveMention(next, caret);
    if (detected) {
      setActiveMention(detected);
      setActiveMentionIndex(0);
    } else {
      setActiveMention(null);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    recomputeMention(e.target.value, e.target.selectionStart);
  };

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    recomputeMention(ta.value, ta.selectionStart);
  };

  const commitMention = useCallback(
    (member: MentionMember) => {
      if (!activeMention) return;
      const ta = textareaRef.current;
      if (!ta) return;
      const before = value.slice(0, activeMention.start);
      const queryEnd = activeMention.start + 1 + activeMention.query.length;
      const after = value.slice(queryEnd);
      const insertion = `@${member.handle} `;
      const next = before + insertion + after;
      setValue(next);
      setActiveMention(null);
      requestAnimationFrame(() => {
        const cursor = before.length + insertion.length;
        ta.focus();
        ta.setSelectionRange(cursor, cursor);
      });
    },
    [activeMention, value]
  );

  // ---- File-drop / paste handlers (T045) ----------------------------------
  const acceptFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const { accepted, errors } = attach.enqueueFiles(files);
      if (errors.length > 0) {
        // De-dupe identical reasons (10 over-cap drops shouldn't fire 10 toasts).
        const unique = new Map(errors.map((e) => [e.message, e]));
        for (const e of unique.values()) toast.error(e.message);
      }
      if (accepted > 0 && errors.length === 0) {
        // Quiet success — the tiles themselves are the feedback.
      }
    },
    [attach]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        acceptFiles(files);
      }
    },
    [acceptFiles]
  );

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      setIsDragOver(true);
    }
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // Only clear when leaving the composer entirely — child mouseovers also
    // fire `dragleave` on the parent.
    if (e.currentTarget === e.target) setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    setIsDragOver(false);
    acceptFiles(Array.from(e.dataTransfer.files));
  };

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    acceptFiles(Array.from(files));
    // Allow the same file to be re-picked later.
    e.target.value = "";
  };

  // ---- Library picker (T050) ----------------------------------------------
  const handlePickerSelect = useCallback(
    ({ assetId, displayName }: { assetId: string; displayName: string | null }) => {
      const result = attach.enqueueAssetRef({
        assetId,
        displayName,
        thumbnailUrl: null, // Resolver in the tile loads from the asset card
      });
      if (!result.ok && result.error) toast.error(result.error.message);
    },
    [attach]
  );

  // ---- Keyboard map -------------------------------------------------------
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (activeMention) {
      if (e.key === "Escape") {
        e.preventDefault();
        setActiveMention(null);
        return;
      }
      if (filteredMembers.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveMentionIndex((i) => (i + 1) % filteredMembers.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveMentionIndex(
            (i) => (i - 1 + filteredMembers.length) % filteredMembers.length
          );
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          commitMention(filteredMembers[activeMentionIndex]);
          return;
        }
      }
    }

    if (e.key === "Escape" && replyTo) {
      e.preventDefault();
      onClearReply?.();
      return;
    }

    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send(value);
    }
  };

  const overLimit = value.length > MAX_BODY_LEN;
  const closeToLimit = !overLimit && value.length > MAX_BODY_LEN - 200;
  const sendDisabled =
    overLimit ||
    sending ||
    attach.hasUnresolved ||
    (!value.trim() && attach.attachments.length === 0);
  const atAttachmentCap = attach.attachments.length >= MAX_ATTACHMENTS;

  return (
    <div
      data-slot="thread-composer"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "relative flex flex-col gap-2 border-t border-border bg-background/95 px-3 pb-3 pt-2",
        "backdrop-blur supports-backdrop-filter:bg-background/80",
        isDragOver && "ring-2 ring-primary/50 ring-inset"
      )}
    >
      {isDragOver ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-md bg-primary/10 text-xs font-medium text-primary ring-1 ring-primary/30 ring-inset"
        >
          Drop to attach
        </div>
      ) : null}

      {failedTempId && failedBody ? (
        <FailedBanner
          body={failedBody}
          onRetry={() => send(failedBody, failedTempId)}
          onDiscard={() => onDiscard(failedTempId)}
        />
      ) : null}

      {replyTo ? (
        <ReplyingToPill replyTo={replyTo} onDismiss={onClearReply} />
      ) : null}

      {attach.attachments.length > 0 ? (
        <div
          role="list"
          aria-label="Pending attachments"
          className="flex flex-wrap gap-1.5"
        >
          {attach.attachments.map((a) => (
            <div role="listitem" key={a.clientId}>
              <ComposerAttachmentTile
                attachment={a}
                onRemove={attach.remove}
                onRetry={attach.retry}
              />
            </div>
          ))}
        </div>
      ) : null}

      <div className="relative flex items-end gap-2">
        <div className="relative flex-1">
          <label htmlFor={inputId} className="sr-only">
            {replyTo ? `Replying to ${replyTo.authorName}` : "Write a message"}
          </label>
          <Textarea
            id={inputId}
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={onKeyDown}
            onSelect={handleSelect}
            onClick={handleSelect}
            onPaste={handlePaste}
            placeholder={
              replyTo
                ? `Replying to ${replyTo.authorName} — type to riff back…`
                : attach.attachments.length > 0
                  ? "Add a note (optional)…"
                  : "Type a message — drop a thought, riff, or reference."
            }
            rows={2}
            aria-multiline="true"
            aria-invalid={overLimit || undefined}
            aria-autocomplete={activeMention ? "list" : undefined}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            aria-describedby={`${inputId}-hint`}
            className="max-h-44 min-h-11 resize-none text-sm"
            disabled={sending && !value}
          />
          {/* Offscreen description for screen readers — the visible hint
              row below is also a description, but it's not always rendered
              (sm:hidden), so we mirror it here for SR-only access. */}
          <span id={`${inputId}-hint`} className="sr-only">
            Press Command Enter on Mac or Control Enter on Windows to send.
            Press at-sign to mention a workspace member. Drag a file onto
            this composer to attach it.
          </span>
          {activeMention ? (
            <div className="absolute bottom-full left-0 z-30 mb-1.5">
              <MentionTypeahead
                members={filteredMembers}
                activeIndex={activeMentionIndex}
                onActiveIndexChange={setActiveMentionIndex}
                onCommit={commitMention}
                onDismiss={() => setActiveMention(null)}
              />
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          size="icon"
          aria-label="Send message"
          aria-keyshortcuts="Meta+Enter Control+Enter"
          disabled={sendDisabled}
          onClick={() => send(value)}
        >
          {sending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Send aria-hidden />
          )}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Attach a file"
            disabled={atAttachmentCap}
            onClick={() => fileInputRef.current?.click()}
            className="size-6"
          >
            <ImageIcon aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Attach from Library"
            disabled={atAttachmentCap}
            onClick={() => setPickerOpen(true)}
            className="size-6"
          >
            <Library aria-hidden />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
            className="sr-only"
            onChange={onFilePick}
          />
          <span className="ml-1.5 hidden sm:inline">
            <span className="font-mono">⌘↵</span> to send ·{" "}
            <span className="font-mono">@</span> to mention · drag to attach
          </span>
        </div>
        <span
          className={cn(
            "font-mono",
            closeToLimit && "text-foreground",
            overLimit && "text-destructive"
          )}
          aria-live="polite"
        >
          {value.length}/{MAX_BODY_LEN}
        </span>
      </div>

      <LibraryAssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handlePickerSelect}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Replying-to pill — sits above the composer when a reply target is set.
// ---------------------------------------------------------------------------

function ReplyingToPill({
  replyTo,
  onDismiss,
}: {
  replyTo: ReplyTarget;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-2 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs",
        "text-foreground ring-1 ring-primary/20"
      )}
    >
      <CornerUpRight className="size-3.5 shrink-0 text-primary" aria-hidden />
      <span className="shrink-0 text-muted-foreground">Replying to</span>
      <span className="font-medium">{replyTo.authorName}</span>
      <span className="ml-1 truncate text-muted-foreground">
        {replyTo.snippet}
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        className="ml-auto size-5 shrink-0"
        onClick={onDismiss}
        aria-label="Cancel reply"
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}

function FailedBanner({
  body,
  onRetry,
  onDiscard,
}: {
  body: string;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive ring-1 ring-destructive/30"
    >
      <div className="flex-1">
        <p className="font-medium">Couldn&apos;t send your last message.</p>
        <p className="mt-0.5 truncate text-destructive/80" title={body}>
          {body}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="xs"
          variant="ghost"
          className="text-destructive hover:bg-destructive/10"
          onClick={onRetry}
        >
          <RefreshCcw aria-hidden />
          Retry
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="text-destructive hover:bg-destructive/10"
          onClick={onDiscard}
          aria-label="Discard"
        >
          <X aria-hidden />
        </Button>
      </div>
    </div>
  );
}

async function safeReadError(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: string };
    if (res.status === 429 || json.error === "rate_limited") {
      return "Slow down a touch — you're sending faster than the room can keep up.";
    }
    return json.error ?? `Couldn't send (status ${res.status}).`;
  } catch {
    return `Couldn't send (status ${res.status}).`;
  }
}
