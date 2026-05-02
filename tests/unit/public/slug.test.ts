/**
 * Public-campaign slug helper unit tests (T008).
 *
 * Pure function — no DB. Asserts FR-002 invariants:
 *   - stem is `[a-z0-9-]+` derived from the input name
 *   - suffix is exactly 6 chars from `[a-z0-9]`
 *   - empty / unicode-only / punctuation-only names fall back to `"campaign"`
 *   - very long names clamp the stem to 40 chars before the suffix
 *   - regenerating produces a different suffix (uniqueness)
 */

import { describe, expect, it } from "vitest";
import {
  generatePublicCampaignSlug,
  regeneratePublicCampaignSlug,
} from "@/lib/public/slug";

const SLUG_PATTERN = /^([a-z0-9-]+)-([a-z0-9]{6})$/;

function splitSlug(slug: string): { stem: string; suffix: string } {
  const match = slug.match(SLUG_PATTERN);
  if (!match) {
    throw new Error(`slug does not match pattern: ${slug}`);
  }
  return { stem: match[1], suffix: match[2] };
}

describe("generatePublicCampaignSlug", () => {
  it("derives the stem from a normal name and appends a 6-char [a-z0-9] suffix", () => {
    const slug = generatePublicCampaignSlug("Summer Launch 2026");
    const { stem, suffix } = splitSlug(slug);
    expect(stem).toBe("summer-launch-2026");
    expect(suffix).toMatch(/^[a-z0-9]{6}$/);
    expect(suffix).toHaveLength(6);
  });

  it("falls back to 'campaign' when the name is empty", () => {
    const slug = generatePublicCampaignSlug("");
    const { stem, suffix } = splitSlug(slug);
    expect(stem).toBe("campaign");
    expect(suffix).toMatch(/^[a-z0-9]{6}$/);
  });

  it("strips unicode and emoji from the stem, leaving only [a-z0-9-]", () => {
    const slug = generatePublicCampaignSlug("Café 🎉 Naïve — Résumé");
    const { stem } = splitSlug(slug);
    // Every character in the stem must be in [a-z0-9-].
    expect(stem).toMatch(/^[a-z0-9-]+$/);
    // No consecutive dashes (collapsed) and no leading/trailing dash.
    expect(stem.startsWith("-")).toBe(false);
    expect(stem.endsWith("-")).toBe(false);
    expect(stem).not.toMatch(/--/);
  });

  it("falls back to 'campaign' when the entire name is punctuation/unicode", () => {
    const slug = generatePublicCampaignSlug("!!! 🎉🎉🎉 ___ ");
    const { stem } = splitSlug(slug);
    expect(stem).toBe("campaign");
  });

  it("clamps the stem to 40 characters before appending the suffix", () => {
    const longName = "a".repeat(120);
    const slug = generatePublicCampaignSlug(longName);
    const { stem, suffix } = splitSlug(slug);
    expect(stem.length).toBe(40);
    expect(stem).toBe("a".repeat(40));
    expect(suffix).toMatch(/^[a-z0-9]{6}$/);
  });

  it("collapses runs of non-alphanumerics into a single dash", () => {
    const slug = generatePublicCampaignSlug("Foo   ___   ###Bar");
    const { stem } = splitSlug(slug);
    expect(stem).toBe("foo-bar");
  });

  it("produces different suffixes across consecutive calls", () => {
    const a = generatePublicCampaignSlug("Same Name");
    const b = generatePublicCampaignSlug("Same Name");
    const c = generatePublicCampaignSlug("Same Name");
    const suffixes = new Set([
      splitSlug(a).suffix,
      splitSlug(b).suffix,
      splitSlug(c).suffix,
    ]);
    // Three independent draws should be unique with overwhelming probability.
    expect(suffixes.size).toBe(3);
  });
});

describe("regeneratePublicCampaignSlug", () => {
  it("produces a different suffix than the prior generate call", () => {
    const original = generatePublicCampaignSlug("Holiday Drop");
    const regenerated = regeneratePublicCampaignSlug("Holiday Drop");
    expect(splitSlug(original).suffix).not.toBe(
      splitSlug(regenerated).suffix,
    );
  });

  it("re-derives the stem from the (possibly renamed) name", () => {
    const slug = regeneratePublicCampaignSlug("Phase 2 — Now With Edges!");
    const { stem, suffix } = splitSlug(slug);
    expect(stem).toBe("phase-2-now-with-edges");
    expect(suffix).toMatch(/^[a-z0-9]{6}$/);
  });

  it("matches the same suffix alphabet/length as generate (FR-002 contract)", () => {
    const slug = regeneratePublicCampaignSlug("anything");
    const { suffix } = splitSlug(slug);
    expect(suffix).toMatch(/^[a-z0-9]{6}$/);
  });
});
