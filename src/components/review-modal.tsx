"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  Megaphone,
  MessageSquareText,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  ReviewFilmstrip,
  nextNonDecisionedIndex,
} from "@/components/review-filmstrip";
import { ThreadPanel } from "@/components/threads/thread-panel";
import { CampaignPicker } from "@/components/asset/campaign-picker";

export interface ReviewQueueItem {
  id: string;
  mediaType: "image" | "video";
  url: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
  prompt: string;
  enhancedPrompt: string | null;
  model: string;
  brandKitOverridden: boolean;
  /** Campaign tags on this asset. Empty array when the asset has no campaign. */
  campaigns: { id: string; name: string }[];
  createdAt: string | Date;
  author: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  };
  canSelfApprove: boolean;
}

interface ReviewModalProps {
  open: boolean;
  queue: ReviewQueueItem[];
  /**
   * Brand the queue belongs to. Used by the inline campaign picker to scope
   * its option list and to gate visibility on the viewer's brand role.
   */
  brandId: string;
  index: number;
  onIndexChange: (next: number) => void;
  onAction: (
    action: "approve" | "reject",
    item: ReviewQueueItem,
    note: string | undefined
  ) => Promise<void> | void;
  /**
   * Called when the user edits campaign tags from inside the modal. Lets the
   * parent keep its `queue`/`displayQueue` state in sync so the filmstrip and
   * the next reviewer surface see the change.
   */
  onCampaignsChange?: (
    itemId: string,
    next: { id: string; name: string }[]
  ) => void;
  onClose: () => void;
  /**
   * Stable snapshot of the queue captured when the modal opened. The filmstrip
   * walks this array so decisioned tiles persist even after `setQueue(filter)`
   * removes them from the live queue. Defaults to `queue` for callers that
   * haven't lifted decisions yet (transition-friendly). See plan.md § "Strip
   * data source".
   */
  displayQueue?: ReviewQueueItem[];
  /**
   * Session-scoped map of decisioned items (`id` -> "approved" | "rejected").
   * Drives the filmstrip's dim + marker rendering AND the `j`/`k` skip rule
   * (see {@link nextNonDecisionedIndex}). Defaults to an empty map for
   * callers that haven't lifted decisions yet.
   */
  sessionDecisions?: Map<string, "approved" | "rejected">;
  /**
   * Viewer info threaded through to the Thread tab so the composer can render
   * without re-resolving the session client-side. Mirrors `LibraryViewer`.
   */
  viewer: {
    id: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

const EMPTY_DECISIONS: Map<string, "approved" | "rejected"> = new Map();

export function ReviewModal({
  open,
  queue,
  brandId,
  index,
  onIndexChange,
  onAction,
  onCampaignsChange,
  onClose,
  displayQueue,
  sessionDecisions,
  viewer,
}: ReviewModalProps) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(
    null
  );
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  // Tabs state — `info` is the default. j/k/a/r shortcuts only fire on Info
  // so typing in the thread composer doesn't trigger queue navigation. The
  // existing `inField` guard would catch the textarea, but Tabs gating is
  // belt-and-suspenders + works for the composer's contenteditable too.
  const [activeTab, setActiveTab] = useState<string>("info");
  // The strip walks the snapshot (`displayQueue`) so decisioned tiles persist
  // even after `setQueue(filter)` removes them. The modal's active asset is
  // resolved against the SAME snapshot — `index` is a `displayQueue` index, not
  // a `queue` index. This is what plan.md § "Risks & Mitigations" #2 describes:
  // we walk `displayQueue` and rely on the queue-empties effect in ReviewClient
  // for termination.
  const stripItems = displayQueue ?? queue;
  const decisions = sessionDecisions ?? EMPTY_DECISIONS;
  const item = stripItems[index];

  useEffect(() => {
    setNote("");
    setSubmitting(null);
  }, [item?.id]);

  // Keyboard nav: j/k next/prev, a approve, r reject, n focus note, Esc close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "INPUT" ||
        // Composer is a contenteditable, not an input — guard explicitly so
        // typing "j" in a thread reply doesn't skip to the next asset.
        target?.isContentEditable === true;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      // Pass through any modifier-held keystroke to the browser. Without
      // this guard, Cmd/Ctrl+R (reload) hits the bare-`r` reject branch
      // and rejects the asset instead of refreshing the page.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (inField) return;
      // Thread tab is active — disable queue shortcuts entirely. The user is
      // reading or composing a message; j/k/a/r should be plain text.
      if (activeTab === "thread") return;
      if (e.key === "j") {
        e.preventDefault();
        // US3 / T020: skip decisioned tiles. Helper returns `index` unchanged
        // when no non-decisioned candidate exists in this direction (no
        // wrap-around, no error per spec AC). When decisions are empty, it
        // falls back to `index + 1` clamped to the snapshot bounds —
        // preserves the existing single-step behavior for first-item nav.
        const nextIdx = nextNonDecisionedIndex(stripItems, decisions, index, 1);
        if (nextIdx !== index) onIndexChange(nextIdx);
      } else if (e.key === "k") {
        e.preventDefault();
        const prevIdx = nextNonDecisionedIndex(
          stripItems,
          decisions,
          index,
          -1
        );
        if (prevIdx !== index) onIndexChange(prevIdx);
      } else if (e.key === "a") {
        e.preventDefault();
        if (item && item.canSelfApprove) handleAction("approve");
      } else if (e.key === "r") {
        e.preventDefault();
        if (item) handleAction("reject");
      } else if (e.key === "n") {
        e.preventDefault();
        noteRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, stripItems.length, item?.id, decisions, activeTab]);

  async function handleAction(action: "approve" | "reject") {
    if (!item || submitting) return;
    setSubmitting(action);
    try {
      await onAction(action, item, note.trim() || undefined);
    } finally {
      setSubmitting(null);
    }
  }

  if (!item) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Queue empty</DialogTitle>
          <DialogDescription>No more assets in this queue.</DialogDescription>
          <Button onClick={onClose} className="mt-4">
            Close
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="grid h-[92vh] w-[min(96vw,1100px)] grid-rows-[1fr] gap-0 overflow-hidden p-0 sm:max-w-[1100px]">
        <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-h-0 flex-col bg-black/95">
            {/* Image area — `min-h-0` lets the flex-1 child actually shrink
                below its content's intrinsic size so the filmstrip rail
                (shrink-0, 64–76px) at the bottom of the column stays inside
                the dialog viewport. The image gets `max-h-full` so it
                letterboxes inside whatever space is left after the rail. */}
            <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
              {item.mediaType === "video" ? (
                <video
                  src={item.url}
                  controls
                  className="max-h-full max-w-full rounded"
                />
              ) : (
                <Image
                  src={item.url}
                  alt={item.prompt}
                  width={item.width ?? 1024}
                  height={item.height ?? 1024}
                  className="max-h-full w-auto rounded object-contain"
                  unoptimized
                />
              )}

              {/* Floating chevrons — preserved on desktop (md+) per Designer
                  call. The filmstrip below subsumes them on mobile so they're
                  hidden under `md:flex` when small screens land. (FR-012) */}
              <button
                type="button"
                onClick={() => onIndexChange(Math.max(0, index - 1))}
                disabled={index === 0}
                className="absolute left-3 top-1/2 hidden -translate-y-1/2 rounded-full bg-background/80 p-2 text-foreground shadow disabled:opacity-30 md:inline-flex"
                aria-label="Previous (k)"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  onIndexChange(Math.min(stripItems.length - 1, index + 1))
                }
                disabled={index >= stripItems.length - 1}
                className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-full bg-background/80 p-2 text-foreground shadow disabled:opacity-30 md:inline-flex"
                aria-label="Next (j)"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            {/* Filmstrip — docks at the bottom of the media pane. Renders
                only when there are items to display; ReviewFilmstrip itself
                short-circuits on empty input but keep the guard explicit so
                the rail surface doesn't reserve space on a degenerate queue. */}
            {stripItems.length > 0 && (
              <ReviewFilmstrip
                items={stripItems}
                activeIndex={index}
                decisions={decisions}
                onActivate={onIndexChange}
              />
            )}
          </div>

          <div className="flex min-h-0 flex-col border-l border-border/60">
            <div className="border-b border-border/60 p-4">
              <DialogTitle className="text-base font-semibold">
                Review {index + 1} of {stripItems.length}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Approve or reject the asset. Use j and k to navigate, a to approve, r to reject, n to focus the note field, Esc to close.
              </DialogDescription>
              <div className="mt-3 flex items-center gap-2">
                <Avatar className="h-7 w-7">
                  <AvatarImage src={item.author.image ?? undefined} />
                  <AvatarFallback className="text-xs">
                    {(item.author.name ?? item.author.email ?? "?")
                      .slice(0, 2)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="text-sm">
                  <div className="font-medium">
                    {item.author.name ?? item.author.email ?? "Unknown"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>

            <Tabs
              value={activeTab}
              onValueChange={(value) => {
                if (typeof value === "string") setActiveTab(value);
              }}
              className="flex min-h-0 flex-1 flex-col gap-0"
            >
              <div className="border-b border-border/60 bg-background px-4 py-2">
                <TabsList variant="line" className="w-full justify-start gap-3">
                  <TabsTrigger value="info">Info</TabsTrigger>
                  <TabsTrigger value="thread">
                    <MessageSquareText aria-hidden />
                    Thread
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent
                value="info"
                className="flex min-h-0 flex-1 flex-col data-[hidden]:hidden"
              >
            <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
              <Field label="Model">{item.model}</Field>
              <Field label="Campaign">
                <CampaignMetadata campaigns={item.campaigns} />
              </Field>
              <CampaignPicker
                assetId={item.id}
                brandId={brandId}
                campaigns={item.campaigns}
                onChange={(next) => onCampaignsChange?.(item.id, next)}
              />
              <Field label="Prompt">
                <p className="whitespace-pre-wrap text-foreground">
                  {item.prompt}
                </p>
              </Field>
              {item.enhancedPrompt && (
                <Field label="Brand-kit prompt">
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {item.enhancedPrompt}
                  </p>
                </Field>
              )}
              {item.brandKitOverridden && (
                <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                  Brand kit was overridden on this generation.
                </div>
              )}

              <div>
                <label
                  htmlFor="review-note"
                  className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground"
                >
                  Note (optional)
                </label>
                <Textarea
                  id="review-note"
                  ref={noteRef}
                  rows={3}
                  placeholder="Reason for rejection, feedback, etc."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>

            <div className="border-t border-border/60 p-4">
              {!item.canSelfApprove && (
                <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
                  You can&apos;t approve your own asset on this brand.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="destructive"
                  onClick={() => handleAction("reject")}
                  disabled={!!submitting}
                >
                  {submitting === "reject" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <XCircle className="mr-2 h-4 w-4" />
                  )}
                  Reject
                  <span className="ml-1 text-[10px] opacity-70">R</span>
                </Button>
                <Button
                  onClick={() => handleAction("approve")}
                  disabled={!!submitting || !item.canSelfApprove}
                >
                  {submitting === "approve" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  Approve
                  <span className="ml-1 text-[10px] opacity-70">A</span>
                </Button>
              </div>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                j / k to walk · a approve · r reject · n note · Esc close
              </p>
            </div>
              </TabsContent>

              <TabsContent
                value="thread"
                className="flex min-h-0 flex-1 flex-col data-[hidden]:hidden"
              >
                <ThreadPanel
                  // Re-mount on asset change so the SSE stream resets cleanly.
                  key={item.id}
                  assetId={item.id}
                  viewer={viewer}
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CampaignMetadata — read-only display of an asset's campaign tags. Always
// renders something: chips when the asset is tagged, em-dash when it isn't.
// Drives the same affordance from the modal, the gallery tile, and the
// filmstrip thumbnail.
// ---------------------------------------------------------------------------
export function CampaignMetadata({
  campaigns,
}: {
  campaigns: { id: string; name: string }[];
}) {
  if (campaigns.length === 0) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-muted-foreground"
        aria-label="No campaign"
      >
        <Megaphone className="size-3.5 opacity-60" aria-hidden />
        <span aria-hidden>—</span>
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {campaigns.map((c) => (
        <span
          key={c.id}
          className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary ring-1 ring-primary/25"
        >
          <Megaphone className="size-3" aria-hidden />
          {c.name}
        </span>
      ))}
    </div>
  );
}
