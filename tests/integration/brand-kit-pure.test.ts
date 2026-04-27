/**
 * Pure-function test for the banned-term checker (FR-015 — case-insensitive
 * substring match). Full DB-backed kit injection tests live in Phase 8.
 */

import { describe, expect, it } from "vitest";
import { matchBannedTerm } from "@/lib/workspace/brand-kit";

describe("matchBannedTerm", () => {
  it("matches case-insensitive substring", () => {
    expect(matchBannedTerm("Bright neon glow", ["neon"])).toBe("neon");
    expect(matchBannedTerm("BRIGHT NEON GLOW", ["neon"])).toBe("neon");
  });

  it("returns first matched term", () => {
    expect(matchBannedTerm("competitor neon banner", ["competitor", "neon"])).toBe("competitor");
  });

  it("returns null when no match", () => {
    expect(matchBannedTerm("a clean brand-on portrait", ["neon"])).toBe(null);
  });

  it("ignores empty banned-term entries", () => {
    expect(matchBannedTerm("anything", ["", " "])).toBe(null);
  });

  it("matches term names with original case (preserves brand kit text)", () => {
    expect(matchBannedTerm("a NEON light", ["Neon"])).toBe("Neon");
  });
});
