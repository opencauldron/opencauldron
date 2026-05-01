/**
 * Body parser unit tests (T023).
 *
 * Pure function — no DB. Asserts mention extraction, autolink correctness,
 * dedupe, and the 10-mention fan-out cap.
 */

import { describe, expect, it } from "vitest";
import { parseBody, type BodyMember } from "@/lib/threads/body-parse";

const MEMBERS: BodyMember[] = [
  { id: "u-sasha", displayName: "Sasha", handle: "sasha" },
  { id: "u-jules", displayName: "Jules Lin", handle: "jules" },
  { id: "u-emoji", displayName: "Emoji-Tester", handle: "emoji.tester" },
];

describe("parseBody — mentions", () => {
  it("extracts a known @handle as a structured mention node", () => {
    const out = parseBody("hi @sasha looks great", MEMBERS);
    expect(out.mentions).toEqual([{ userId: "u-sasha" }]);
    const types = out.structuredBody.map((n) => n.kind);
    expect(types).toEqual(["text", "mention", "text"]);
  });

  it("dedupes the same user mentioned twice", () => {
    const out = parseBody("@sasha @sasha", MEMBERS);
    expect(out.mentions).toEqual([{ userId: "u-sasha" }]);
  });

  it("ignores unknown handles (no mention emitted)", () => {
    const out = parseBody("@alien hi", MEMBERS);
    expect(out.mentions).toEqual([]);
    expect(out.structuredBody.map((n) => n.kind)).toEqual(["text"]);
  });

  it("matches case-insensitively", () => {
    const out = parseBody("hello @SASHA", MEMBERS);
    expect(out.mentions).toEqual([{ userId: "u-sasha" }]);
  });

  it("supports . and _ and - in handles", () => {
    const out = parseBody("ping @emoji.tester", MEMBERS);
    expect(out.mentions).toEqual([{ userId: "u-emoji" }]);
  });

  it("doesn't capture trailing punctuation as part of the handle", () => {
    const out = parseBody("hey @sasha, what about that?", MEMBERS);
    expect(out.mentions).toEqual([{ userId: "u-sasha" }]);
    const lastText = out.structuredBody.at(-1);
    expect(lastText?.kind).toBe("text");
    if (lastText?.kind === "text") {
      expect(lastText.text.startsWith(",")).toBe(true);
    }
  });

  it("caps mention fan-out at 10 users", () => {
    const big: BodyMember[] = Array.from({ length: 12 }, (_, i) => ({
      id: `u${i}`,
      displayName: `User${i}`,
      handle: `user${i}`,
    }));
    const text = big.map((m) => `@${m.handle}`).join(" ");
    const out = parseBody(text, big);
    expect(out.mentions.length).toBe(10);
  });
});

describe("parseBody — autolinks", () => {
  it("extracts http(s) URLs as autolink nodes", () => {
    const out = parseBody("see https://example.com please", MEMBERS);
    expect(out.links).toEqual([{ url: "https://example.com" }]);
    expect(out.structuredBody.map((n) => n.kind)).toEqual([
      "text",
      "autolink",
      "text",
    ]);
  });

  it("strips trailing punctuation from URLs", () => {
    const out = parseBody("see https://example.com.", MEMBERS);
    expect(out.links).toEqual([{ url: "https://example.com" }]);
  });

  it("dedupes repeated URLs", () => {
    const out = parseBody(
      "https://example.com again https://example.com",
      MEMBERS
    );
    expect(out.links).toEqual([{ url: "https://example.com" }]);
  });

  it("doesn't autolink javascript: pseudo-URLs (only http(s))", () => {
    const out = parseBody("evil javascript:alert(1)", MEMBERS);
    expect(out.links).toEqual([]);
  });
});

describe("parseBody — preserves whitespace + structure", () => {
  it("keeps leading/trailing whitespace and newlines", () => {
    const out = parseBody("  hi\n@sasha\n  ", MEMBERS);
    const text = out.structuredBody
      .map((n) => (n.kind === "text" ? n.text : `[m:${n.kind}]`))
      .join("");
    expect(text).toBe("  hi\n[m:mention]\n  ");
  });

  it("emits empty mentions/links arrays for plain text", () => {
    const out = parseBody("just text here", MEMBERS);
    expect(out.mentions).toEqual([]);
    expect(out.links).toEqual([]);
  });
});
