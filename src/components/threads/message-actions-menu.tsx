"use client";

import {
  CornerUpLeft,
  Copy,
  MoreHorizontal,
  Pencil,
  Smile,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmojiPickerPopover } from "./emoji-picker-popover";

// ---------------------------------------------------------------------------
// Message-actions menu (T037, expanded from the Phase 3 stub).
//
// Items, in order:
//   - Add reaction (quick-pick, separate trigger) — opens the emoji picker
//   - Reply              — sets composer's replyTo state via onReply
//   - Copy text          — clipboard write of the message body
//   - Edit (own only)    — toggles the row's inline editor
//   - Delete (own/mod)   — soft-delete via the existing handler
//
// Everyone sees the trigger so non-author actions (react / reply / copy) are
// reachable. Author-only items only render for `isOwnMessage`. Workspace
// owners (`canModerate`) can also delete other people's messages.
// ---------------------------------------------------------------------------

export interface MessageActionsMenuProps {
  isOwnMessage: boolean;
  canModerate?: boolean;
  /** True when the row has a non-null body to copy. Disables Copy when false. */
  hasBody: boolean;
  onAddReaction: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function MessageActionsMenu({
  isOwnMessage,
  canModerate = false,
  hasBody,
  onAddReaction,
  onReply,
  onCopy,
  onEdit,
  onDelete,
}: MessageActionsMenuProps) {
  const canDelete = isOwnMessage || canModerate;

  return (
    <div className="flex items-center gap-0.5">
      {/* Quick-react chip — same picker as the dropdown's "Add reaction" item
          but reachable in one click. */}
      <EmojiPickerPopover
        onSelect={onAddReaction}
        trigger={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Add reaction"
            className="size-7"
          >
            <Smile aria-hidden />
          </Button>
        }
      />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Message actions"
              className="size-7"
            />
          }
        >
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4}>
          <DropdownMenuItem onClick={onReply}>
            <CornerUpLeft aria-hidden />
            Reply
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onCopy} disabled={!hasBody}>
            <Copy aria-hidden />
            Copy text
          </DropdownMenuItem>
          {(isOwnMessage || canDelete) && <DropdownMenuSeparator />}
          {isOwnMessage ? (
            <DropdownMenuItem onClick={onEdit}>
              <Pencil aria-hidden />
              Edit
            </DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 aria-hidden />
              Delete
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
