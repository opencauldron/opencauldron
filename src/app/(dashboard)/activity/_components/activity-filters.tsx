"use client";

/**
 * Activity feed filter chrome (US6 / T090).
 *
 * Two filter dimensions, both URL-driven:
 *   - **Chips** (multi-select) — `?chips=approvals,feats` (comma-separated
 *     chip IDs; the API resolves them to verbs server-side).
 *   - **Time window** (single-select) — `?since=today|7d|30d` or omitted
 *     for "all time" (default).
 *
 * URL is the canonical state. Toggling a chip updates the URL via
 * `router.replace` (no history-bloat per click). The page re-renders via
 * Next's RSC stream — the `key` on the `<Suspense>` in `page.tsx` includes
 * chips + since so the feed's pagination state resets cleanly.
 *
 * Chip ID format: short user-friendly slugs (`approvals` not
 * `generation.approved,generation.rejected,generation.submitted`). Lets
 * URLs stay short and verb-rename safe.
 *
 * Cursor reset: any filter change drops `?cursor=` so the cursor doesn't
 * point into a list filtered differently than what comes back. The "Tab"
 * row already does this on tab change; we apply the same rule here.
 */

import { useCallback, useMemo, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ACTIVITY_CHIP_LABELS,
  ACTIVITY_CHIP_VALUES,
  ACTIVITY_SINCE_LABELS,
  ACTIVITY_SINCE_VALUES,
  type ActivityChip,
  type ActivitySince,
} from "@/lib/activity-feed-types";

const SINCE_DEFAULT: ActivitySince = "all";

export function ActivityFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Parse current URL state — single source of truth.
  const activeChips = useMemo<Set<ActivityChip>>(() => {
    const raw = searchParams.get("chips");
    if (!raw) return new Set();
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return new Set(
      parts.filter((c): c is ActivityChip =>
        (ACTIVITY_CHIP_VALUES as readonly string[]).includes(c)
      )
    );
  }, [searchParams]);

  const activeSince = useMemo<ActivitySince>(() => {
    const raw = searchParams.get("since");
    if (raw && (ACTIVITY_SINCE_VALUES as readonly string[]).includes(raw)) {
      return raw as ActivitySince;
    }
    return SINCE_DEFAULT;
  }, [searchParams]);

  const hasFilters = activeChips.size > 0 || activeSince !== SINCE_DEFAULT;

  /**
   * Compose a new URL with the given filter overrides + always-drop the
   * cursor (filters changed = cursor invalid). Preserves `tab` and any
   * other unrelated params.
   */
  const buildHref = useCallback(
    (overrides: { chips?: ActivityChip[]; since?: ActivitySince }) => {
      const next = new URLSearchParams(searchParams.toString());

      if (overrides.chips !== undefined) {
        if (overrides.chips.length === 0) next.delete("chips");
        else next.set("chips", overrides.chips.join(","));
      }
      if (overrides.since !== undefined) {
        if (overrides.since === SINCE_DEFAULT) next.delete("since");
        else next.set("since", overrides.since);
      }
      // Filter changes always drop the cursor — see header docstring.
      next.delete("cursor");
      const qs = next.toString();
      return qs ? `/activity?${qs}` : "/activity";
    },
    [searchParams]
  );

  const navigate = useCallback(
    (href: string) => {
      startTransition(() => {
        router.replace(href, { scroll: false });
      });
    },
    [router]
  );

  const onToggleChip = useCallback(
    (chip: ActivityChip) => {
      const next = new Set(activeChips);
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      // Preserve declared chip order — keeps URLs deterministic across clicks.
      const ordered = ACTIVITY_CHIP_VALUES.filter((c) => next.has(c));
      navigate(buildHref({ chips: ordered }));
    },
    [activeChips, navigate, buildHref]
  );

  const onSinceChange = useCallback(
    (value: ActivitySince | string | null) => {
      // Base UI's Select can emit `null` when the value is unset; default
      // to the canonical "all" so we never write an invalid token to the URL.
      const next = (value as ActivitySince | null) ?? SINCE_DEFAULT;
      navigate(buildHref({ since: next }));
    },
    [navigate, buildHref]
  );

  const onClear = useCallback(() => {
    navigate(buildHref({ chips: [], since: SINCE_DEFAULT }));
  }, [navigate, buildHref]);

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      aria-label="Activity filters"
    >
      <ul role="list" className="flex flex-wrap items-center gap-1.5">
        {ACTIVITY_CHIP_VALUES.map((chip) => {
          const selected = activeChips.has(chip);
          return (
            <li key={chip}>
              <Button
                type="button"
                size="sm"
                variant={selected ? "secondary" : "ghost"}
                aria-pressed={selected}
                onClick={() => onToggleChip(chip)}
                disabled={isPending}
                // Slim down the default Button height so chips read as a
                // chip strip, not a button bar.
                className="h-7 rounded-full px-3 text-xs font-medium"
              >
                {ACTIVITY_CHIP_LABELS[chip]}
              </Button>
            </li>
          );
        })}
      </ul>

      <div className="ml-auto flex items-center gap-2">
        <Select value={activeSince} onValueChange={onSinceChange}>
          <SelectTrigger
            aria-label="Time window"
            className="h-8 w-[140px] text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTIVITY_SINCE_VALUES.map((s) => (
              <SelectItem key={s} value={s}>
                {ACTIVITY_SINCE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClear}
            disabled={isPending}
            className="h-7 px-2 text-xs text-muted-foreground"
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
