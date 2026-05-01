/**
 * Unit tests for `nextNonDecisionedIndex` — the helper that drives the
 * filmstrip's `j`/`k` skip-traversal in `review-modal.tsx`. Per
 * `specs/review-modal-filmstrip/spec.md`, this is the highest-risk regression
 * vector for the feature: if skip logic is wrong, reviewers either land on
 * already-decisioned items (annoying) or skip past undecisioned ones
 * (correctness bug). The matrix below covers every scenario called out in
 * tasks.md § Phase 5 / T023.
 */

import { describe, expect, it } from "vitest";
import { nextNonDecisionedIndex } from "@/components/review-filmstrip";
import type { ReviewQueueItem } from "@/components/review-modal";

// Minimal fixture — the helper only inspects `id`, so the rest is filler.
function makeItems(n: number): ReviewQueueItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `item-${i}`,
    thumbnailUrl: "",
    prompt: "",
    mediaType: "image" as const,
    canSelfApprove: false,
    submittedAt: "",
    author: { id: "", name: "", image: null },
    brandKitOverridden: false,
  })) as unknown as ReviewQueueItem[];
}

const empty = new Map<string, "approved" | "rejected">();

describe("nextNonDecisionedIndex", () => {
  it("empty decisions: j (forward) increments by 1", () => {
    const items = makeItems(3);
    expect(nextNonDecisionedIndex(items, empty, 0, 1)).toBe(1);
  });

  it("empty decisions: k (backward) decrements by 1", () => {
    const items = makeItems(3);
    expect(nextNonDecisionedIndex(items, empty, 2, -1)).toBe(1);
  });

  it("empty decisions: j at the end returns `from` (no wrap)", () => {
    const items = makeItems(3);
    expect(nextNonDecisionedIndex(items, empty, 2, 1)).toBe(2);
  });

  it("empty decisions: k at the start returns `from` (no wrap)", () => {
    const items = makeItems(3);
    expect(nextNonDecisionedIndex(items, empty, 0, -1)).toBe(0);
  });

  it("approve item 0: j from 0 lands on 1 (skip self)", () => {
    const items = makeItems(3);
    const decisions = new Map([["item-0", "approved" as const]]);
    expect(nextNonDecisionedIndex(items, decisions, 0, 1)).toBe(1);
  });

  it("approve items 0 + 1: j from 0 lands on 2", () => {
    const items = makeItems(3);
    const decisions = new Map<string, "approved" | "rejected">([
      ["item-0", "approved"],
      ["item-1", "approved"],
    ]);
    expect(nextNonDecisionedIndex(items, decisions, 0, 1)).toBe(2);
  });

  it("approve item 1: k from 2 lands on 0 (skip middle)", () => {
    const items = makeItems(3);
    const decisions = new Map([["item-1", "rejected" as const]]);
    expect(nextNonDecisionedIndex(items, decisions, 2, -1)).toBe(0);
  });

  it("all decisioned: j returns `from` (no error, no wrap)", () => {
    const items = makeItems(3);
    const decisions = new Map<string, "approved" | "rejected">([
      ["item-0", "approved"],
      ["item-1", "approved"],
      ["item-2", "rejected"],
    ]);
    expect(nextNonDecisionedIndex(items, decisions, 1, 1)).toBe(1);
    expect(nextNonDecisionedIndex(items, decisions, 1, -1)).toBe(1);
  });

  it("rejected and approved both count as decisioned", () => {
    const items = makeItems(4);
    const decisions = new Map<string, "approved" | "rejected">([
      ["item-1", "approved"],
      ["item-2", "rejected"],
    ]);
    expect(nextNonDecisionedIndex(items, decisions, 0, 1)).toBe(3);
  });

  it("walks past multiple decisioned items in one call", () => {
    const items = makeItems(6);
    const decisions = new Map<string, "approved" | "rejected">([
      ["item-1", "approved"],
      ["item-2", "approved"],
      ["item-3", "rejected"],
      ["item-4", "approved"],
    ]);
    expect(nextNonDecisionedIndex(items, decisions, 0, 1)).toBe(5);
  });
});
