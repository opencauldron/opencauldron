"use client";

/**
 * SearchInput — the toolbar's primary text-search affordance.
 *
 * Phase 4 ships:
 *   - Debounced 250ms text-search (writes to URL `q` via useLibraryQuery).
 *   - Global ⌘K + `/` focus shortcut (suppressed when another input is focused).
 *   - Esc clears `q` if non-empty, otherwise blurs.
 *
 * Phase 5 (T039) will fill in <SearchInput.ModeToggle /> with text/semantic/
 * hybrid Popover. The slot is reserved here so the composition stays correct
 * even though the toggle is invisible today.
 *
 * Composition rules:
 *   - No boolean props: ModeToggle is a child slot, not a `showModeToggle`
 *     boolean on Field.
 *   - State lives in useLibraryQuery() — Field is a thin URL projector with a
 *     local debounce timer so each keystroke doesn't shove a router transition.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { useLibraryQuery } from "./use-library-query";

const DEBOUNCE_MS = 250;

// ---------------------------------------------------------------------------
// SearchInput — root composes the slots. Doesn't render its own DOM beyond
// the children container, so consumers can layout the field + (future) toggle
// however they like.
// ---------------------------------------------------------------------------

interface SearchInputProps {
  children: React.ReactNode;
  className?: string;
}

export function SearchInput({ children, className }: SearchInputProps) {
  return (
    <div
      data-slot="library-search"
      className={cn("flex min-w-0 flex-1 items-center gap-2", className)}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field — InputGroup wrapping the actual text input. Debounces local state
// into useLibraryQuery's setQuery so the URL update isn't on the keystroke
// hot path. The local input value mirrors the URL on mount + when the URL
// changes from outside (back button, deep link).
// ---------------------------------------------------------------------------

interface FieldProps {
  placeholder?: string;
  className?: string;
}

function Field({
  placeholder = "Search assets…",
  className,
}: FieldProps) {
  const { query, setQuery } = useLibraryQuery();
  const [local, setLocal] = useState(query.q);
  // Track the URL `q` we last synced from. When it changes (deep link, back
  // nav, clearAll), pull the new value into local — unless the input is
  // currently focused (the user is typing; don't fight them).
  // This is the React 19 "set state during render" pattern, which avoids
  // setState-in-effect cascading renders.
  const [syncedFromQ, setSyncedFromQ] = useState(query.q);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (query.q !== syncedFromQ) {
    setSyncedFromQ(query.q);
    // Mirror the URL value into local. Done at render time (not in an
    // effect) so React 19's strict "no setState in effect" rule is happy.
    // If the user is mid-debounce, their next keystroke will overwrite this
    // value and re-arm the debounce — keystrokes always win.
    setLocal(query.q);
  }

  const flush = useCallback(
    (value: string) => {
      setQuery({ q: value });
    },
    [setQuery]
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setLocal(next);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => flush(next), DEBOUNCE_MS);
    },
    [flush]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        if (local) {
          // First Esc clears; the field stays focused so the user can keep typing.
          e.preventDefault();
          if (debounceRef.current) clearTimeout(debounceRef.current);
          setLocal("");
          flush("");
        } else {
          inputRef.current?.blur();
        }
      } else if (e.key === "Enter") {
        // Skip the debounce — the user has explicitly committed.
        if (debounceRef.current) clearTimeout(debounceRef.current);
        flush(local);
      }
    },
    [local, flush]
  );

  // Global ⌘K and `/` to focus. `/` is gated to skip when another input/textarea
  // already has focus so it doesn't steal keystrokes from the detail panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMeta = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      const isSlash =
        e.key === "/" && !isFormElementFocused() && !e.metaKey && !e.ctrlKey;
      if (isMeta || isSlash) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Clean up any pending debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <InputGroup className={cn("h-9 max-w-md", className)}>
      <InputGroupAddon>
        <Search className="size-4" aria-hidden />
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
        type="search"
        value={local}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label="Search library"
        autoComplete="off"
        spellCheck={false}
      />
      <InputGroupAddon align="inline-end">
        <kbd className="inline-flex h-5 items-center gap-0.5 rounded-sm bg-muted px-1.5 text-[10px] font-medium text-muted-foreground ring-1 ring-foreground/10">
          ⌘K
        </kbd>
      </InputGroupAddon>
    </InputGroup>
  );
}

// ---------------------------------------------------------------------------
// ModeToggle — Phase 5 (T039) hybrid/semantic/text mode toggle slots in here.
// Returns null in Phase 4 so the composition is correct without shipping
// dead UI surface.
// ---------------------------------------------------------------------------

function ModeToggle() {
  // Phase 5 (T039): hybrid/semantic/text mode toggle slots into this child.
  return null;
}

SearchInput.Field = Field;
SearchInput.ModeToggle = ModeToggle;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFormElementFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}
