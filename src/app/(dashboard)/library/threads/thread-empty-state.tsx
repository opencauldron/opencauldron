"use client";

import { MessageCircleMore } from "lucide-react";

// ---------------------------------------------------------------------------
// Empty state for an asset thread with zero messages.
// Voice: warm, low-stakes, OpenCauldron — never corporate. Designer will
// refine in T033, but this ships serviceable.
// ---------------------------------------------------------------------------

export function ThreadEmptyState() {
  return (
    <div
      data-slot="thread-empty-state"
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center"
    >
      <div
        aria-hidden
        className="relative flex size-12 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20"
      >
        <MessageCircleMore
          className="size-5 text-primary"
          strokeWidth={1.5}
          aria-hidden
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -right-2 -top-2 size-3 rounded-full bg-primary opacity-30 blur-md"
        />
      </div>
      <div className="flex max-w-xs flex-col gap-1">
        <p className="font-heading text-sm font-medium text-foreground">
          The room&apos;s quiet.
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Kick it off — riff on the direction, tag a teammate, or paste a
          reference. The conversation stays pinned to this asset, so future-you
          can find it.
        </p>
      </div>
    </div>
  );
}
