/**
 * Unit tests for the focus + interval refetch poller (T082 / US5).
 *
 * The React hook (`useFocusAndIntervalRefetch`) is a thin `useEffect`
 * wrapper around `createFocusAndIntervalPoller` — a pure factory that
 * accepts injected timer + DOM shims. We test the factory directly so the
 * suite doesn't need `@testing-library/react` or a DOM environment (the
 * repo has neither — see vitest.config.ts: no jsdom / happy-dom). The hook
 * itself is glue and is verified manually in dev.
 *
 * Coverage matrix per US5 acceptance criteria:
 *   1. Tab visible + interval elapsed   → refetch fires
 *   2. Tab hidden                        → interval is paused (no fetch)
 *   3. Tab transitions hidden → visible  → refetch fires immediately
 *   4. Cleanup                           → all listeners + timers removed
 *   5. Debounce                          → no double-fire when visible-fire
 *                                          and interval-fire collide
 *   6. enabled=false                     → nothing wired up
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFocusAndIntervalPoller,
  type PollerEnv,
} from "@/hooks/use-focus-and-interval-refetch";

/** Build a manual fake `PollerEnv` so each test owns its own clock + state. */
function makeEnv() {
  const listeners = new Map<string, Set<EventListener>>();
  const intervals = new Map<number, { fn: () => void; ms: number }>();
  let nextIntervalId = 1;
  let visibility: "visible" | "hidden" = "visible";

  const env: PollerEnv = {
    addVisibilityListener(fn) {
      const set = listeners.get("visibilitychange") ?? new Set();
      set.add(fn);
      listeners.set("visibilitychange", set);
    },
    removeVisibilityListener(fn) {
      listeners.get("visibilitychange")?.delete(fn);
    },
    setInterval(fn, ms) {
      const id = nextIntervalId++;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    getVisibility() {
      return visibility;
    },
    now() {
      return Date.now();
    },
  };

  return {
    env,
    setVisibility(next: "visible" | "hidden") {
      visibility = next;
      // Fire all attached visibilitychange listeners — match the browser.
      const set = listeners.get("visibilitychange");
      if (set) {
        for (const fn of set) fn(new Event("visibilitychange"));
      }
    },
    fireInterval() {
      // Fire every active interval once.
      for (const { fn } of intervals.values()) fn();
    },
    listenerCount() {
      return listeners.get("visibilitychange")?.size ?? 0;
    },
    intervalCount() {
      return intervals.size;
    },
  };
}

/**
 * Drain pending microtasks so the `await refetch()` inside `tryFire` has a
 * chance to clear the `inFlight` guard between synchronous events. Real
 * browsers always have a tick between user inputs; the harness simulates
 * sync events back-to-back, so we need to do this manually.
 */
async function flush() {
  // A few rounds is enough to clear nested `await refetch() → finally`.
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("createFocusAndIntervalPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("AC #1: fires refetch when interval elapses while tab is visible", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    const harness = makeEnv();
    createFocusAndIntervalPoller({
      env: harness.env,
      refetch,
      intervalMs: 45_000,
      enabled: true,
    });

    expect(refetch).not.toHaveBeenCalled();
    harness.fireInterval();
    await flush();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("AC #2: skips the interval fire when document is hidden", async () => {
    const refetch = vi.fn();
    const harness = makeEnv();
    createFocusAndIntervalPoller({
      env: harness.env,
      refetch,
      intervalMs: 45_000,
      enabled: true,
    });

    harness.setVisibility("hidden");
    await flush();
    refetch.mockClear(); // discard any visibility-driven fire
    harness.fireInterval();
    await flush();
    expect(refetch).not.toHaveBeenCalled();
  });

  it("AC #3: fires immediately when tab transitions hidden → visible", async () => {
    const refetch = vi.fn();
    const harness = makeEnv();
    createFocusAndIntervalPoller({
      env: harness.env,
      refetch,
      intervalMs: 45_000,
      enabled: true,
    });

    // Start hidden so the initial-fire path doesn't muddy the assertion.
    harness.setVisibility("hidden");
    await flush();
    refetch.mockClear();

    harness.setVisibility("visible");
    await flush();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("AC #4: cleanup removes the visibility listener and clears the interval", () => {
    const refetch = vi.fn();
    const harness = makeEnv();
    const poller = createFocusAndIntervalPoller({
      env: harness.env,
      refetch,
      intervalMs: 45_000,
      enabled: true,
    });

    expect(harness.listenerCount()).toBe(1);
    expect(harness.intervalCount()).toBe(1);

    poller.cleanup();

    expect(harness.listenerCount()).toBe(0);
    expect(harness.intervalCount()).toBe(0);
  });

  it("AC #5: debounces a visible-fire that lands within 5s of an interval-fire", async () => {
    const refetch = vi.fn();
    let nowMs = 1_000_000;
    const harness = makeEnv();
    harness.env.now = () => nowMs;

    createFocusAndIntervalPoller({
      env: harness.env,
      refetch,
      intervalMs: 45_000,
      enabled: true,
      debounceMs: 5_000,
    });

    // Interval fires at t=0
    harness.fireInterval();
    await flush();
    expect(refetch).toHaveBeenCalledTimes(1);

    // 2s later the user toggles back to the tab (well within 5s debounce).
    nowMs += 2_000;
    harness.setVisibility("hidden");
    await flush();
    harness.setVisibility("visible");
    await flush();
    expect(refetch).toHaveBeenCalledTimes(1); // still 1 — debounced

    // 6s after the original fire (>5s past) — visible-fire goes through.
    nowMs += 4_000;
    harness.setVisibility("hidden");
    await flush();
    harness.setVisibility("visible");
    await flush();
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("does not stack interval calls when the previous refetch is still in flight", async () => {
    // `resolve` is assigned inside the Promise constructor — TS can't see
    // the side-effect assignment from the outer scope's perspective, so
    // we type it explicitly to match what we're actually doing.
    let resolve: (() => void) | undefined;
    const refetch = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    const harness = makeEnv();
    createFocusAndIntervalPoller({
      env: harness.env,
      refetch,
      intervalMs: 45_000,
      enabled: true,
    });

    harness.fireInterval();
    await flush();
    expect(refetch).toHaveBeenCalledTimes(1);

    // Second tick before the first resolves — should be skipped.
    harness.fireInterval();
    await flush();
    expect(refetch).toHaveBeenCalledTimes(1);

    // Resolve the in-flight call; next tick should fire again.
    resolve?.();
    await flush();
    harness.fireInterval();
    await flush();
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("enabled=false: wires nothing up and never fires refetch", async () => {
    const refetch = vi.fn();
    const harness = makeEnv();
    createFocusAndIntervalPoller({
      env: harness.env,
      refetch,
      intervalMs: 45_000,
      enabled: false,
    });

    expect(harness.listenerCount()).toBe(0);
    expect(harness.intervalCount()).toBe(0);

    harness.fireInterval();
    harness.setVisibility("hidden");
    harness.setVisibility("visible");
    await flush();
    expect(refetch).not.toHaveBeenCalled();
  });
});
