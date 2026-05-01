"use client";

import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Emoji picker (T035) — wraps the `emoji-picker-element` web component.
//
// The library is a vanilla web component. To use it from React we register
// the custom element once (idempotent — `customElements.define` throws on
// re-registration so we guard) and forward the `emoji-click` CustomEvent to
// a React `onSelect` callback.
//
// This component is the *inner* picker only — it renders the picker UI and
// nothing else. The outer trigger + popover wrapper lives in
// `<EmojiPickerPopover>` so consumers can co-locate the trigger.
//
// LAZY-LOAD: the parent should `React.lazy` this whole file. The
// `emoji-picker-element` import is the bundle bloat we want to defer.
// ---------------------------------------------------------------------------

interface EmojiClickEvent extends CustomEvent {
  detail: { unicode: string };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "emoji-picker": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        class?: string;
      };
    }
  }
}

let elementRegistered = false;

async function ensureRegistered(): Promise<void> {
  if (elementRegistered) return;
  // The web component self-registers on import. We only need to import it
  // once per page load.
  await import("emoji-picker-element");
  elementRegistered = true;
}

export interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

/**
 * Inner picker — the web component. Wrap in a Popover at the call site.
 * The web component is dark-friendly out of the box; we apply a light tint
 * via CSS variables to keep it consistent with the popover surface.
 */
export default function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let cancelled = false;
    ensureRegistered().then(() => {
      if (cancelled || !containerRef.current) return;
      // Render the element imperatively so we can attach the CustomEvent
      // listener before any paint can dispatch one.
      const container = containerRef.current;
      if (container.querySelector("emoji-picker")) return;
      const el = document.createElement("emoji-picker");
      // Force the dark theme — app is dark-locked at <html>.
      el.classList.add("dark");
      // Apply the design-system tokens via the picker's documented CSS hooks.
      // See https://github.com/nolanlawson/emoji-picker-element#styling.
      el.style.setProperty("--background", "var(--popover)");
      el.style.setProperty("--input-border-color", "transparent");
      el.style.setProperty("--input-font-color", "var(--popover-foreground)");
      el.style.setProperty(
        "--input-placeholder-color",
        "var(--muted-foreground)"
      );
      el.style.setProperty("--border-color", "color-mix(in oklab, var(--foreground) 10%, transparent)");
      el.style.setProperty("--button-active-background", "var(--accent)");
      el.style.setProperty("--button-hover-background", "var(--accent)");
      el.style.setProperty("--indicator-color", "var(--primary)");
      el.style.setProperty("--num-columns", "8");
      el.style.height = "320px";
      el.style.width = "100%";

      const handler = (ev: Event) => {
        const detail = (ev as EmojiClickEvent).detail;
        if (detail?.unicode) onSelectRef.current(detail.unicode);
      };
      el.addEventListener("emoji-click", handler);
      container.appendChild(el);

      // Return a teardown handler — the outer `useEffect` cleanup wraps it.
      // We have to bind the cleanup here because `el` is captured locally.
      const cleanup = () => {
        el.removeEventListener("emoji-click", handler);
        if (el.parentElement === container) container.removeChild(el);
      };
      // Stash on the container for the outer return — we can't return from
      // an `.then()` cleanly into the effect's cleanup. Instead, attach the
      // teardown to the element and let the outer effect close over the ref.
      (container as HTMLDivElement & { __emojiCleanup?: () => void }).__emojiCleanup = cleanup;
    });
    // Capture the container ref now so the teardown closure doesn't read
    // `.current` after unmount (when it could be null).
    const container = containerRef.current as
      | (HTMLDivElement & { __emojiCleanup?: () => void })
      | null;
    return () => {
      cancelled = true;
      container?.__emojiCleanup?.();
      if (container) delete container.__emojiCleanup;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      data-slot="emoji-picker"
      className="overflow-hidden rounded-md"
      role="dialog"
      aria-label="Choose an emoji"
    />
  );
}
