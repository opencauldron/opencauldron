"use client";

import { memo, useEffect, useRef } from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Inline mention typeahead (T038).
//
// Pure presentational + keyboard-handler component. The composer owns:
//   * what string the user is typing
//   * which `@<query>` token is active (or `null` when not in a mention)
//   * the highlighted index
//   * caret position for placement
//
// We just render the popover surface positioned near the textarea. The
// composer shells out to `commit(member)` when the user presses Enter or
// clicks a row.
// ---------------------------------------------------------------------------

export interface MentionMember {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface MentionTypeaheadProps {
  /** Filtered candidate list. The composer pre-filters by the query. */
  members: MentionMember[];
  /** Highlighted index into `members`. */
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  /** Called when the user picks a member (click or Enter). */
  onCommit: (member: MentionMember) => void;
  /** Called when the user dismisses (Esc, blur, or empty list). */
  onDismiss: () => void;
}

function MentionTypeaheadImpl({
  members,
  activeIndex,
  onActiveIndexChange,
  onCommit,
  onDismiss,
}: MentionTypeaheadProps) {
  const listRef = useRef<HTMLUListElement | null>(null);

  // Scroll the highlighted row into view whenever the index changes.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const node = list.children[activeIndex] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (members.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-lg bg-popover p-2 text-xs text-muted-foreground shadow-md ring-1 ring-foreground/10"
      >
        No teammates match.
      </div>
    );
  }

  return (
    <div
      role="listbox"
      aria-label="Mention a teammate"
      className="w-64 max-w-[16rem] overflow-hidden rounded-lg bg-popover shadow-md ring-1 ring-foreground/10"
    >
      <ul ref={listRef} className="max-h-56 overflow-y-auto py-1">
        {members.map((m, i) => {
          const active = i === activeIndex;
          return (
            <li
              key={m.id}
              role="option"
              aria-selected={active}
              onMouseEnter={() => onActiveIndexChange(i)}
              onMouseDown={(e) => {
                // mousedown (not click) so the textarea doesn't lose focus
                // before we commit.
                e.preventDefault();
                onCommit(m);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm",
                active ? "bg-accent text-accent-foreground" : "text-foreground"
              )}
            >
              <Avatar size="sm" className="size-6">
                {m.avatarUrl ? (
                  <AvatarImage src={m.avatarUrl} alt={m.displayName} />
                ) : null}
                <AvatarFallback className="text-[10px]">
                  {initials(m.displayName)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate font-medium">{m.displayName}</span>
              <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
                @{m.handle}
              </span>
            </li>
          );
        })}
      </ul>
      {/* Hidden dismiss for keyboard users — Esc handler lives in the composer. */}
      <button
        type="button"
        onClick={onDismiss}
        className="sr-only"
        aria-label="Dismiss mention picker"
      />
    </div>
  );
}

export const MentionTypeahead = memo(MentionTypeaheadImpl);

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return (
    parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || name[0] || "?"
  );
}

// ---------------------------------------------------------------------------
// Helper — extract the active `@<query>` token at the caret. Returns the
// token's `start` index in `value` and the lower-cased query, or `null` if
// the caret isn't immediately past an `@<chars>` run with no whitespace
// between `@` and the caret.
//
// Examples (caret marked with |):
//   "Hey @sa|"       → { start: 4, query: "sa" }
//   "Hey @sasha cool|" → null  (whitespace breaks the token)
//   "@sa|"           → { start: 0, query: "sa" }
//   "user@gmai|l"    → null  (preceding char must be start-of-string,
//                              whitespace, or punctuation — not a word char)
// ---------------------------------------------------------------------------

export function extractActiveMention(
  value: string,
  caret: number
): { start: number; query: string } | null {
  // Walk backward from caret looking for an `@`. Bail when we see whitespace
  // or hit the start. Reject if the matched run contains a non-handle char.
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === "@") {
      // Verify the preceding char is start-of-string OR whitespace OR
      // punctuation — don't match emails like "user@gmail.com".
      const prev = i > 0 ? value[i - 1] : "";
      if (prev !== "" && /[A-Za-z0-9_]/.test(prev)) return null;
      const query = value.slice(i + 1, caret);
      // Empty query is fine ("@" alone shows the full list); reject if any
      // char in the run isn't handle-shaped.
      if (query.length > 0 && !/^[A-Za-z0-9._-]+$/.test(query)) return null;
      return { start: i, query: query.toLowerCase() };
    }
    if (/\s/.test(ch)) return null;
    if (!/[A-Za-z0-9._-]/.test(ch)) return null;
    i -= 1;
  }
  return null;
}

/**
 * Filter + rank members against a typed query. Prefix matches rank above
 * substring matches; ties broken by display name length (shorter first), then
 * alphabetically.
 */
export function filterMembers(
  members: MentionMember[],
  query: string,
  cap: number = 8
): MentionMember[] {
  if (!query) return members.slice(0, cap);
  const q = query.toLowerCase();
  const scored: { member: MentionMember; score: number }[] = [];
  for (const m of members) {
    const handle = m.handle.toLowerCase();
    const display = m.displayName.toLowerCase();
    let score = -1;
    if (handle.startsWith(q) || display.startsWith(q)) score = 100;
    else if (handle.includes(q) || display.includes(q)) score = 50;
    if (score < 0) continue;
    // Prefer shorter names on ties so "@al" prefers "Alex" over "Alexandra".
    score -= display.length * 0.01;
    scored.push({ member: m, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.member.displayName.localeCompare(b.member.displayName)
  );
  return scored.slice(0, cap).map((s) => s.member);
}
