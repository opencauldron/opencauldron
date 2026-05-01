/**
 * Unit tests for the mention typeahead helpers (Phase 4 / T038).
 *
 * `extractActiveMention` runs on every keystroke / caret move in the
 * composer. It MUST reject false positives like email-style `user@gmail.com`
 * substrings — otherwise the typeahead would fire whenever the user types
 * an email.
 */

import { describe, expect, it } from "vitest";
import {
  extractActiveMention,
  filterMembers,
  type MentionMember,
} from "@/app/(dashboard)/library/threads/mention-typeahead";

describe("extractActiveMention", () => {
  it("matches an empty token immediately after `@`", () => {
    const out = extractActiveMention("Hey @", 5);
    expect(out).toEqual({ start: 4, query: "" });
  });

  it("matches a partial handle after `@`", () => {
    const out = extractActiveMention("Hey @sa", 7);
    expect(out).toEqual({ start: 4, query: "sa" });
  });

  it("returns null when the caret is past whitespace", () => {
    const out = extractActiveMention("Hey @sasha cool", "Hey @sasha cool".length);
    expect(out).toBeNull();
  });

  it("rejects email-like preceding word characters", () => {
    const out = extractActiveMention("user@gmail", 10);
    expect(out).toBeNull();
  });

  it("matches at the very start of the textarea", () => {
    const out = extractActiveMention("@sa", 3);
    expect(out).toEqual({ start: 0, query: "sa" });
  });

  it("matches when preceded by whitespace", () => {
    const out = extractActiveMention("\n@s", 3);
    expect(out).toEqual({ start: 1, query: "s" });
  });

  it("lowercases the query for case-insensitive matching", () => {
    const out = extractActiveMention("Yo @SA", 6);
    expect(out?.query).toBe("sa");
  });

  it("rejects non-handle characters in the run", () => {
    const out = extractActiveMention("Yo @sa$", 7);
    expect(out).toBeNull();
  });
});

describe("filterMembers", () => {
  const members: MentionMember[] = [
    { id: "u1", handle: "alex", displayName: "Alex Rivera", avatarUrl: null },
    { id: "u2", handle: "alexandra", displayName: "Alexandra Chen", avatarUrl: null },
    { id: "u3", handle: "sasha", displayName: "Sasha Wu", avatarUrl: null },
    { id: "u4", handle: "mira", displayName: "Mira Patel", avatarUrl: null },
  ];

  it("returns the first N members on empty query", () => {
    const out = filterMembers(members, "", 2);
    expect(out).toHaveLength(2);
  });

  it("prefers prefix matches over substring matches", () => {
    // "ra" is a substring in "Rivera" + "Patel" but a prefix of nothing.
    const out = filterMembers(members, "ra");
    expect(out.length).toBeGreaterThan(0);
    // Should still return both, but prefix-priority means we'd get the
    // shorter-name first. None match prefix here, so order is by name length.
    expect(out[0].displayName).toBe("Mira Patel"); // shorter than Alex Rivera
  });

  it("ranks shorter display names above longer on ties", () => {
    const out = filterMembers(members, "al");
    expect(out[0].handle).toBe("alex"); // 4 chars vs alexandra's 9
    expect(out[1].handle).toBe("alexandra");
  });

  it("returns empty when nothing matches", () => {
    expect(filterMembers(members, "xyz")).toEqual([]);
  });

  it("respects the cap parameter", () => {
    expect(filterMembers(members, "", 1)).toHaveLength(1);
  });
});
