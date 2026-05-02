/**
 * Focus + interval refetch hook (US5 / T080).
 *
 * Polls a `refetch` callback on two triggers:
 *   1. Every `intervalMs` (default 45s) — but only while the tab is visible.
 *   2. Whenever the tab transitions hidden → visible (immediate fire).
 *
 * Interval is paused while the tab is hidden so we don't burn DB queries
 * on backgrounded tabs (US5 acceptance criterion #2). On regaining
 * visibility we fire once immediately so users see fresh data right away
 * (US5 AC #3) — but with a debounce window (`debounceMs`, default 5s) so
 * the visible-fire doesn't double-up with a recent interval-fire.
 *
 * In-flight protection: if the previous `refetch()` hasn't resolved when
 * a new trigger fires, the new trigger is dropped. This avoids piling up
 * requests on a slow network and keeps `prepend new events` behavior in
 * the caller deterministic (one update at a time).
 *
 * Architecture:
 *   - The pure logic lives in `createFocusAndIntervalPoller`, which
 *     accepts an injected `PollerEnv` (timer + DOM shims). This makes
 *     the suite trivial to write without `@testing-library/react` or a
 *     DOM environment (the repo has neither — see vitest.config.ts).
 *   - The React surface (`useFocusAndIntervalRefetch`) is a thin
 *     `useEffect` that wires up the poller against `window` / `document`
 *     and tears it down on unmount or option change.
 */

import { useEffect, useRef } from "react";

const DEFAULT_INTERVAL_MS = 45_000;
const DEFAULT_DEBOUNCE_MS = 5_000;

/**
 * Injectable environment for `createFocusAndIntervalPoller`. Real callers
 * use the browser globals; tests use a fake. Anything that touches the
 * outside world goes through this interface.
 */
export interface PollerEnv {
  addVisibilityListener(fn: EventListener): void;
  removeVisibilityListener(fn: EventListener): void;
  setInterval(fn: () => void, ms: number): number;
  clearInterval(id: number): void;
  getVisibility(): "visible" | "hidden" | "prerender" | "unloaded";
  /** Monotonic-ish "right now" in ms; used for debouncing. */
  now(): number;
}

interface PollerOptions {
  env: PollerEnv;
  refetch: () => void | Promise<void>;
  intervalMs?: number;
  /** Skip a visible-fire if a refetch fired within this window. */
  debounceMs?: number;
  enabled?: boolean;
}

/**
 * Pure factory for the polling logic. Returns a `cleanup()` that removes
 * all listeners + clears the interval. Safe to call multiple times.
 *
 * If `enabled === false`, returns a no-op cleanup and wires nothing up.
 * That matches the React hook's "skip everything when disabled" contract.
 */
export function createFocusAndIntervalPoller(opts: PollerOptions) {
  const {
    env,
    refetch,
    intervalMs = DEFAULT_INTERVAL_MS,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    enabled = true,
  } = opts;

  if (!enabled) {
    return { cleanup: () => {} };
  }

  let lastFireAt = 0;
  let inFlight = false;

  const tryFire = async (reason: "interval" | "visible") => {
    const visibility = env.getVisibility();
    if (visibility !== "visible") return; // AC #2 — never fire while hidden
    if (inFlight) return; // don't pile up requests
    if (
      reason === "visible" &&
      lastFireAt > 0 &&
      env.now() - lastFireAt < debounceMs
    ) {
      // AC #5 — visible-fire collides with a recent interval-fire; skip.
      return;
    }
    lastFireAt = env.now();
    inFlight = true;
    try {
      await refetch();
    } finally {
      inFlight = false;
    }
  };

  const onVisibilityChange: EventListener = () => {
    if (env.getVisibility() === "visible") {
      void tryFire("visible");
    }
  };

  env.addVisibilityListener(onVisibilityChange);

  // Interval is global — the visibility check inside `tryFire` is the
  // pause mechanism. We don't tear down + recreate the interval on
  // visibility flips; that adds complexity for no benefit (a paused
  // interval costs ~one no-op tick per minute).
  const intervalId = env.setInterval(() => {
    void tryFire("interval");
  }, intervalMs);

  return {
    cleanup() {
      env.removeVisibilityListener(onVisibilityChange);
      env.clearInterval(intervalId);
    },
  };
}

interface UseFocusAndIntervalRefetchOptions {
  refetch: () => void | Promise<void>;
  intervalMs?: number;
  enabled?: boolean;
}

/**
 * React hook wrapper around `createFocusAndIntervalPoller`. Wires up the
 * browser's `document.visibilityState` and `setInterval` and cleans them
 * up on unmount.
 *
 * The latest `refetch` callback is captured in a ref so callers don't need
 * to memoize it — but the poller itself only re-creates when `intervalMs`
 * or `enabled` changes (avoids visibility-listener thrash on every parent
 * re-render).
 */
export function useFocusAndIntervalRefetch({
  refetch,
  intervalMs = DEFAULT_INTERVAL_MS,
  enabled = true,
}: UseFocusAndIntervalRefetchOptions) {
  const refetchRef = useRef(refetch);
  // Keep the latest callback reachable from the (stable) effect closure.
  // Updating in an effect — not during render — keeps the lint clean and
  // avoids the React 19 strict-mode double-render footgun.
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof document === "undefined") return; // SSR / RSC safety

    const env: PollerEnv = {
      addVisibilityListener(fn) {
        document.addEventListener("visibilitychange", fn);
      },
      removeVisibilityListener(fn) {
        document.removeEventListener("visibilitychange", fn);
      },
      setInterval(fn, ms) {
        return window.setInterval(fn, ms);
      },
      clearInterval(id) {
        window.clearInterval(id);
      },
      getVisibility() {
        return document.visibilityState;
      },
      now() {
        return Date.now();
      },
    };

    const poller = createFocusAndIntervalPoller({
      env,
      refetch: () => refetchRef.current(),
      intervalMs,
      enabled: true,
    });

    return poller.cleanup;
  }, [intervalMs, enabled]);
}
