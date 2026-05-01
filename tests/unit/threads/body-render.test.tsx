/**
 * Body renderer unit tests (T023).
 *
 * XSS fixtures are the high-value case — the renderer must NEVER emit raw
 * HTML or attribute injection. All output is React's plain-element tree.
 *
 * We use `react-dom/server` `renderToStaticMarkup` to assert the raw HTML
 * the renderer produces, then check it for danger patterns. No DOM needed.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BodyRenderer } from "@/lib/threads/body-render";
import { parseBody, type BodyMember } from "@/lib/threads/body-parse";

const MEMBERS: BodyMember[] = [
  { id: "u-sasha", displayName: "Sasha", handle: "sasha" },
];

function renderBody(input: string): string {
  const parsed = parseBody(input, MEMBERS);
  return renderToStaticMarkup(<BodyRenderer nodes={parsed.structuredBody} />);
}

describe("body-render — XSS fixtures", () => {
  it("escapes <script> tags as plain text", () => {
    const out = renderBody("<script>alert('pwned')</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("escapes attribute injection attempts", () => {
    const out = renderBody('"><img src=x onerror=alert(1)>');
    // The literal `onerror=` text remains inside a span as escaped content;
    // what matters is that no live HTML element (`<img>`) renders, so no
    // attribute can fire.
    expect(out).not.toContain("<img");
    expect(out).not.toMatch(/<\w+[^>]*onerror=/i);
    expect(out).toContain("&quot;&gt;&lt;img");
  });

  it("does not pass through HTML entities as raw HTML", () => {
    const out = renderBody("&lt;script&gt;");
    // React escapes the &-prefixed sequences again — they should appear as
    // doubly-escaped text, not turned back into literal angle brackets.
    expect(out).toContain("&amp;lt;script&amp;gt;");
  });

  it("does not autolink javascript: URLs", () => {
    const out = renderBody("javascript:alert(1)");
    expect(out).not.toContain("href=\"javascript:");
  });

  it("autolinked URLs render with rel=noopener noreferrer + target=_blank", () => {
    const out = renderBody("https://example.com");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });
});

describe("body-render — markdown-lite formatting", () => {
  it("renders **bold**", () => {
    const out = renderBody("hello **world**");
    expect(out).toContain("<strong>world</strong>");
  });

  it("renders *italic*", () => {
    const out = renderBody("be *brave*");
    expect(out).toContain("<em>brave</em>");
  });

  it("renders inline `code`", () => {
    const out = renderBody("use the `useState` hook");
    expect(out).toContain("<code");
    expect(out).toContain("useState");
  });

  it("renders fenced code blocks", () => {
    const out = renderBody("see this:\n```\nconst x = 1;\n```\n");
    expect(out).toContain("<pre");
    expect(out).toContain("const x = 1;");
  });

  it("does not interpret markdown inside fenced code", () => {
    const out = renderBody("```\n**not bold**\n```");
    // Asterisks should still be present as literal text inside the pre.
    expect(out).toContain("**not bold**");
    expect(out).not.toContain("<strong>not bold</strong>");
  });

  it("inline code wins over bold/italic", () => {
    const out = renderBody("`**not bold**`");
    expect(out).toContain("<code");
    expect(out).not.toContain("<strong>");
  });

  it("renders line breaks as <br />", () => {
    const out = renderBody("line one\nline two");
    expect(out).toContain("<br/>");
  });
});

describe("body-render — mentions", () => {
  it("emits a span with data-mention-user-id for known handles", () => {
    const out = renderBody("@sasha looks great");
    expect(out).toContain('data-mention-user-id="u-sasha"');
    expect(out).toContain("@Sasha");
  });

  it("does not render unknown handles as mentions", () => {
    const out = renderBody("@alien is mysterious");
    expect(out).not.toContain('data-mention-user-id');
  });
});
