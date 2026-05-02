/**
 * Unit tests for `mergeHeadRefetch` — the pure prepend-without-jitter
 * helper that powers US5 polling in `<ActivityFeed>` and the dashboard
 * rail (T081 / T082).
 *
 * The "no re-render when nothing changed" guarantee (US5 AC #4) is
 * encoded as a *reference identity* check: the function returns the
 * exact `prev` array when there are no new items. React's setState bails
 * out on Object.is equality, so returning the same reference suppresses
 * the re-render. This is the load-bearing detail being tested below.
 */

import { describe, expect, it } from "vitest";
import {
  mergeHeadRefetch,
  type HydratedActivityEvent,
} from "@/lib/activity-feed-types";

// Minimal event factory — only `id` is read by the helper, the rest is
// filler so the type checks.
function ev(id: string): HydratedActivityEvent {
  return {
    id,
    createdAt: "2026-05-02T00:00:00.000Z",
    verb: "generation.created",
    visibility: "workspace",
    brandId: null,
    actor: { id: "u1", name: "Adam", image: null },
    brand: null,
    object: { type: "unknown", id },
    metadata: {},
    href: null,
  };
}

describe("mergeHeadRefetch", () => {
  it("returns prev reference when head ids match (no jitter)", () => {
    const prev = [ev("a"), ev("b"), ev("c")];
    const fresh = [ev("a"), ev("b")]; // same head, fewer items
    const out = mergeHeadRefetch(prev, fresh);
    // Critical: same reference (===), not just deep-equal — this is what
    // tells React's setState to skip the re-render.
    expect(out).toBe(prev);
  });

  it("prepends new events ahead of the loaded list", () => {
    const prev = [ev("a"), ev("b")];
    const fresh = [ev("c"), ev("a")]; // new head 'c'
    const out = mergeHeadRefetch(prev, fresh);
    expect(out.map((e) => e.id)).toEqual(["c", "a", "b"]);
  });

  it("dedupes new events against the loaded ids", () => {
    const prev = [ev("a"), ev("b"), ev("c")];
    const fresh = [ev("d"), ev("c"), ev("b")]; // 'c' + 'b' already known
    const out = mergeHeadRefetch(prev, fresh);
    expect(out.map((e) => e.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("returns prev reference when fresh contains only known ids", () => {
    const prev = [ev("a"), ev("b")];
    const fresh = [ev("b")]; // entirely overlaps prev — but head differs
    const out = mergeHeadRefetch(prev, fresh);
    // No novel ids → no work → same reference. The head-id check would
    // miss this (prev[0]='a' vs fresh[0]='b'), but the dedupe catches it.
    expect(out).toBe(prev);
  });

  it("returns prev reference when fresh is empty", () => {
    const prev = [ev("a"), ev("b")];
    const out = mergeHeadRefetch(prev, []);
    expect(out).toBe(prev);
  });

  it("populates an empty list from a non-empty fresh response", () => {
    const out = mergeHeadRefetch([], [ev("a"), ev("b")]);
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("trims the merged list to `maxItems` (rail use-case)", () => {
    const prev = [ev("a"), ev("b"), ev("c"), ev("d"), ev("e"), ev("f")]; // 6
    const fresh = [ev("z"), ev("y"), ev("a")]; // 2 new
    const out = mergeHeadRefetch(prev, fresh, 6);
    // ['z','y'] prepended → 8 → trimmed to 6 — drops the oldest
    expect(out.map((e) => e.id)).toEqual(["z", "y", "a", "b", "c", "d"]);
  });

  it("does not trim when maxItems is omitted (page use-case)", () => {
    const prev = [ev("a"), ev("b")];
    const fresh = [ev("z")];
    const out = mergeHeadRefetch(prev, fresh);
    expect(out).toHaveLength(3);
    expect(out.map((e) => e.id)).toEqual(["z", "a", "b"]);
  });
});
