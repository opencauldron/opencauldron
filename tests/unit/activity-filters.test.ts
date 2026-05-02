/**
 * Unit tests for the US6 filter resolvers (T092 / Phase 8).
 *
 * Pure functions in `activity-feed-types.ts`:
 *   - `resolveChipsToVerbs` — chip ID → verb[] union, with dedupe + tamper-safety.
 *   - `resolveSince`        — since token → absolute Date lower bound.
 *
 * Both live in the client-safe types module so they can run in tests
 * without a DB and be imported by both the route handler (server) and the
 * filter UI (client).
 */

import { describe, expect, it } from "vitest";
import {
  ACTIVITY_CHIP_VALUES,
  resolveChipsToVerbs,
  resolveSince,
} from "@/lib/activity-feed-types";

describe("resolveChipsToVerbs", () => {
  it("expands a single chip to its verb list", () => {
    expect(resolveChipsToVerbs(["approvals"]).sort()).toEqual([
      "generation.approved",
      "generation.rejected",
      "generation.submitted",
    ]);
  });

  it("unions verbs across multiple chips, deduped", () => {
    const verbs = resolveChipsToVerbs(["approvals", "drafts"]);
    expect(new Set(verbs)).toEqual(
      new Set([
        "generation.submitted",
        "generation.approved",
        "generation.rejected",
        "generation.created",
        "generation.completed",
      ])
    );
  });

  it("dedupes when the same chip is passed twice", () => {
    expect(resolveChipsToVerbs(["feats", "feats"])).toEqual([
      "member.earned_feat",
    ]);
  });

  it("silently drops unknown chip ids (URL-tampering safety)", () => {
    expect(
      resolveChipsToVerbs(["approvals", "not-a-chip", ""]).sort()
    ).toEqual([
      "generation.approved",
      "generation.rejected",
      "generation.submitted",
    ]);
  });

  it("returns empty array for empty input (caller interprets as 'no filter')", () => {
    expect(resolveChipsToVerbs([])).toEqual([]);
  });

  it("every advertised chip resolves to at least one verb", () => {
    for (const chip of ACTIVITY_CHIP_VALUES) {
      expect(resolveChipsToVerbs([chip]).length).toBeGreaterThan(0);
    }
  });
});

describe("resolveSince", () => {
  // Fixed UTC clock for deterministic boundary math.
  const now = new Date("2026-05-02T15:30:00.000Z");

  it("'today' anchors to UTC midnight of `now`", () => {
    const d = resolveSince("today", now);
    expect(d?.toISOString()).toBe("2026-05-02T00:00:00.000Z");
  });

  it("'7d' is exactly 7 * 24h before now", () => {
    const d = resolveSince("7d", now);
    expect(d?.toISOString()).toBe("2026-04-25T15:30:00.000Z");
  });

  it("'30d' is exactly 30 * 24h before now", () => {
    const d = resolveSince("30d", now);
    expect(d?.toISOString()).toBe("2026-04-02T15:30:00.000Z");
  });

  it("'all' returns null (no lower bound)", () => {
    expect(resolveSince("all", now)).toBeNull();
  });

  it("null / undefined / empty all return null", () => {
    expect(resolveSince(null, now)).toBeNull();
    expect(resolveSince(undefined, now)).toBeNull();
    expect(resolveSince("", now)).toBeNull();
  });

  it("unknown tokens return null (URL-tampering safety)", () => {
    expect(resolveSince("yesterday", now)).toBeNull();
    expect(resolveSince("1y", now)).toBeNull();
  });
});
