"use client";

import { cn } from "@/lib/utils";

/**
 * Custom checkbox surfaced over each grid card. Mirrors the visual contract
 * of `CheckboxRow` in `library/filter-bar.tsx` — a small filled-square check,
 * with `bg-primary` when active. Hidden by default; revealed on hover, when
 * the card is focused, or when at least one item is already selected (so
 * users can click any checkbox without first hovering it).
 */

interface BulkSelectCheckboxProps {
  checked: boolean;
  onToggle: (event: { shiftKey?: boolean }) => void;
  /** True when selection is non-empty — keeps the checkbox visible after the
   *  first click so further multi-selects don't require hover precision. */
  alwaysVisible?: boolean;
  className?: string;
  label?: string;
}

export function BulkSelectCheckbox({
  checked,
  onToggle,
  alwaysVisible,
  className,
  label = "Select",
}: BulkSelectCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        // Don't bubble — the parent card has its own click handler that opens
        // the detail panel.
        e.stopPropagation();
        onToggle({ shiftKey: e.shiftKey });
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onToggle({ shiftKey: e.shiftKey });
        }
      }}
      data-slot="bulk-select-checkbox"
      data-state={checked ? "checked" : "unchecked"}
      className={cn(
        "absolute left-2 top-2 z-20 inline-flex size-5 items-center justify-center rounded-md ring-1 ring-foreground/15 backdrop-blur-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        checked
          ? "bg-primary text-primary-foreground ring-primary opacity-100"
          : "bg-background/80 text-foreground opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100",
        alwaysVisible && !checked && "opacity-100",
        className
      )}
    >
      {checked ? (
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-3"
        >
          <path d="M3 8l3 3 7-7" />
        </svg>
      ) : null}
    </button>
  );
}
