"use client";

import { lazy, Suspense, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// ---------------------------------------------------------------------------
// Popover wrapper around the lazy-loaded EmojiPicker (T035).
//
// The picker bundle (`emoji-picker-element` + assets) only downloads the
// first time a user opens a popover — until then this file is just an empty
// Popover shell.
// ---------------------------------------------------------------------------

const EmojiPicker = lazy(() => import("./emoji-picker"));

export interface EmojiPickerPopoverProps {
  /** Element that opens the picker. Must be focusable. */
  trigger: ReactNode;
  onSelect: (emoji: string) => void;
  /** Side of the trigger to anchor the popover to. Default: top. */
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}

export function EmojiPickerPopover({
  trigger,
  onSelect,
  side = "top",
  align = "end",
}: EmojiPickerPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger as React.ReactElement} />
      <PopoverContent
        side={side}
        align={align}
        sideOffset={6}
        // The picker has its own header/search; turn off the default popover
        // padding so the picker fills the surface edge-to-edge.
        className="w-fit gap-0 p-0"
      >
        {open ? (
          <Suspense
            fallback={
              <div
                className="flex h-[320px] w-[320px] items-center justify-center"
                role="status"
                aria-label="Loading emoji picker"
              >
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <EmojiPicker
              onSelect={(emoji) => {
                onSelect(emoji);
                setOpen(false);
              }}
            />
          </Suspense>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
