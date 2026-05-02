"use client";

import { memo } from "react";
import { Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { EmojiPickerPopover } from "./emoji-picker-popover";
import type { ClientMessageReaction } from "./types";

// ---------------------------------------------------------------------------
// Grouped reactions chip-row beneath a message body (T036).
//
// Each chip = emoji + count + tooltip listing the first N reactors.
// Clicking toggles the viewer's reaction (optimistic; reconciled by the SSE
// `reaction.toggled` event in `useThreadStream`'s reducer — no canonical
// refetch).
//
// A trailing "add reaction" trigger opens the emoji picker popover; selecting
// an emoji invokes `onToggle` with the chosen unicode.
// ---------------------------------------------------------------------------

export interface ReactionRowProps {
  reactions: ClientMessageReaction[];
  onToggle: (emoji: string) => void;
  /**
   * Hide the trailing "add reaction" trigger when the message is in a state
   * that shouldn't accept new reactions (deleted, soft-pending, etc).
   */
  canAddNew?: boolean;
}

function ReactionRowImpl({
  reactions,
  onToggle,
  canAddNew = true,
}: ReactionRowProps) {
  if (reactions.length === 0 && !canAddNew) return null;

  return (
    <div
      data-slot="reaction-row"
      className="mt-1 flex flex-wrap items-center gap-1"
    >
      {reactions.map((r) => (
        <ReactionChip key={r.emoji} reaction={r} onToggle={onToggle} />
      ))}
      {canAddNew ? (
        <EmojiPickerPopover
          onSelect={onToggle}
          trigger={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Add reaction"
              className={cn(
                "size-6 rounded-full text-muted-foreground",
                // Hidden until hover/focus on the row, mirroring how the
                // actions menu reveals.
                "opacity-0 transition-opacity",
                "group-hover/message:opacity-100 group-focus-within/message:opacity-100",
                // When at least one reaction exists, the chip-add stays
                // visible (the row already takes vertical space).
                reactions.length > 0 && "opacity-100"
              )}
            >
              <Smile aria-hidden />
            </Button>
          }
        />
      ) : null}
    </div>
  );
}

export const ReactionRow = memo(ReactionRowImpl);

// ---------------------------------------------------------------------------
// Single reaction chip
// ---------------------------------------------------------------------------

function ReactionChip({
  reaction,
  onToggle,
}: {
  reaction: ClientMessageReaction;
  onToggle: (emoji: string) => void;
}) {
  const tooltip = formatReactorList(reaction);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`${reaction.emoji} reaction, ${reaction.count} ${
              reaction.count === 1 ? "reactor" : "reactors"
            }${reaction.viewerReacted ? ", you reacted" : ""}`}
            aria-pressed={reaction.viewerReacted}
            onClick={() => onToggle(reaction.emoji)}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs",
              "ring-1 transition-colors active:translate-y-px",
              reaction.viewerReacted
                ? "bg-primary/10 text-primary ring-primary/30 hover:bg-primary/15"
                : "bg-muted text-foreground ring-foreground/10 hover:bg-accent"
            )}
          />
        }
      >
        <span aria-hidden className="leading-none">
          {reaction.emoji}
        </span>
        <span className="font-mono text-[10px] tabular-nums">
          {reaction.count}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function formatReactorList(reaction: ClientMessageReaction): string {
  const names = reaction.reactors
    .map((r) => r.displayName ?? "Someone")
    .filter((n): n is string => Boolean(n));
  if (names.length === 0) {
    return `${reaction.count} reaction${reaction.count === 1 ? "" : "s"}`;
  }
  if (names.length === reaction.count) {
    return formatNameList(names);
  }
  // Truncated list (server caps `reactors` at 8).
  const remaining = reaction.count - names.length;
  return `${formatNameList(names)} and ${remaining} more`;
}

function formatNameList(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
