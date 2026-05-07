"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Generic multi-select primitive for grid views (Library, Gallery).
 *
 * Behavior:
 *   - Click to toggle one id.
 *   - Shift-click extends from the last toggled id to the new id, inclusive,
 *     in the order the items array was passed in. Range mode adds (never
 *     removes) so the caller can build the selection up.
 *   - Cmd/Ctrl+A selects every visible (currently-loaded) item, scoped via
 *     the `containerRef` so selection only fires when focus is inside.
 *   - Esc clears the selection.
 *   - When the items list changes (e.g. filter swap, cursor refetch), any
 *     selected ids that no longer appear are dropped automatically — the bar
 *     never acts on assets the user can't see.
 */

export interface BulkSelection {
  selectedIds: Set<string>;
  isSelected: (id: string) => boolean;
  toggle: (id: string, event?: { shiftKey?: boolean }) => void;
  selectAllVisible: () => void;
  clear: () => void;
  count: number;
}

export interface UseBulkSelectionOptions {
  /** Ref of the surface that should anchor keyboard shortcuts. */
  containerRef: React.RefObject<HTMLElement | null>;
  /**
   * Optional disable flag — useful when a modal is open over the grid and
   * we don't want Cmd+A / Esc to fight with form fields.
   */
  enabled?: boolean;
}

export function useBulkSelection<T>(
  items: T[],
  getId: (item: T) => string,
  options: UseBulkSelectionOptions
): BulkSelection {
  const { containerRef, enabled = true } = options;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);

  const getIdRef = useRef(getId);
  getIdRef.current = getId;
  const idList = useMemo(() => items.map((item) => getIdRef.current(item)), [items]);

  // Render-time prune: if the id list reference changed, drop any selected
  // ids that vanished. Mirrors the previous-prop sentinel pattern used in
  // library-asset-picker-dialog.tsx so we don't trip
  // `react-hooks/set-state-in-effect`.
  const [prevIdList, setPrevIdList] = useState<string[]>(idList);
  if (prevIdList !== idList) {
    setPrevIdList(idList);
    setSelectedIds((current) => {
      if (current.size === 0) return current;
      const visible = new Set(idList);
      let mutated = false;
      const next = new Set<string>();
      for (const id of current) {
        if (visible.has(id)) next.add(id);
        else mutated = true;
      }
      return mutated ? next : current;
    });
  }

  const toggle = useCallback(
    (id: string, event?: { shiftKey?: boolean }) => {
      const ids = idList;
      if (event?.shiftKey && anchorRef.current) {
        const start = ids.indexOf(anchorRef.current);
        const end = ids.indexOf(id);
        if (start >= 0 && end >= 0) {
          const [lo, hi] = start <= end ? [start, end] : [end, start];
          setSelectedIds((prev) => {
            const next = new Set(prev);
            for (let i = lo; i <= hi; i++) next.add(ids[i]);
            return next;
          });
          anchorRef.current = id;
          return;
        }
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchorRef.current = id;
    },
    [idList]
  );

  const selectAllVisible = useCallback(() => {
    setSelectedIds(new Set(idList));
    anchorRef.current = idList[0] ?? null;
  }, [idList]);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
    anchorRef.current = null;
  }, []);

  // Keyboard shortcuts. Cmd/Ctrl+A only fires when the container has focus
  // (or contains the active element) so we don't hijack the page-level
  // browser shortcut when the user is focused in a search input outside the
  // grid.
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const target = e.target as Node | null;
      const inContainer =
        target instanceof Node &&
        (container === target || container.contains(target));
      if (!inContainer) return;

      // Don't hijack typing in inputs/textareas/contenteditable.
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        if (idList.length === 0) return;
        e.preventDefault();
        selectAllVisible();
        return;
      }
      if (e.key === "Escape") {
        if (selectedIds.size === 0) return;
        e.preventDefault();
        clear();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [containerRef, enabled, idList, selectAllVisible, clear, selectedIds]);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds]
  );

  return {
    selectedIds,
    isSelected,
    toggle,
    selectAllVisible,
    clear,
    count: selectedIds.size,
  };
}
