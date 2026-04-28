"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
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
  index: number;
  onIndexChange: (next: number) => void;
  onAction: (
    action: "approve" | "reject",
    item: ReviewQueueItem,
    note: string | undefined
  ) => Promise<void> | void;
  onClose: () => void;
}

export function ReviewModal({
  open,
  queue,
  index,
  onIndexChange,
  onAction,
  onClose,
}: ReviewModalProps) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(
    null
  );
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const item = queue[index];

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
        target?.tagName === "TEXTAREA" || target?.tagName === "INPUT";
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (inField) return;
      if (e.key === "j") {
        e.preventDefault();
        if (index < queue.length - 1) onIndexChange(index + 1);
      } else if (e.key === "k") {
        e.preventDefault();
        if (index > 0) onIndexChange(index - 1);
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
  }, [open, index, queue.length, item?.id]);

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
      <DialogContent className="max-h-[92vh] w-[min(96vw,1100px)] overflow-hidden p-0 sm:max-w-[1100px]">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_360px]">
          <div className="relative flex min-h-[60vh] items-center justify-center bg-black/95 p-4">
            {item.mediaType === "video" ? (
              <video
                src={item.url}
                controls
                className="max-h-[88vh] max-w-full rounded"
              />
            ) : (
              <Image
                src={item.url}
                alt={item.prompt}
                width={item.width ?? 1024}
                height={item.height ?? 1024}
                className="max-h-[88vh] w-auto rounded object-contain"
                unoptimized
              />
            )}

            <button
              type="button"
              onClick={() => onIndexChange(Math.max(0, index - 1))}
              disabled={index === 0}
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-2 text-foreground shadow disabled:opacity-30"
              aria-label="Previous (k)"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() =>
                onIndexChange(Math.min(queue.length - 1, index + 1))
              }
              disabled={index >= queue.length - 1}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-2 text-foreground shadow disabled:opacity-30"
              aria-label="Next (j)"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          <div className="flex max-h-[88vh] flex-col border-l border-border/60">
            <div className="border-b border-border/60 p-4">
              <DialogTitle className="text-base font-semibold">
                Review {index + 1} of {queue.length}
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

            <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
              <Field label="Model">{item.model}</Field>
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
