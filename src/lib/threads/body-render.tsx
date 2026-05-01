/**
 * Markdown-lite renderer (T011).
 *
 * XSS-safe by construction: the input is a string, the output is a React
 * tree of plain elements. There is no `dangerouslySetInnerHTML`, no HTML
 * passthrough, no third-party markdown engine. The recognised subset is:
 *
 *   * fenced code blocks   ` ```\n...\n``` `
 *   * inline code          `` `...` ``
 *   * bold                 `**...**`
 *   * italic               `*...*`     (single-asterisk)
 *   * autolink mentions    via `parseBody` nodes (T010)
 *   * bare URLs            via `parseBody` nodes (T010)
 *   * line breaks          `\n`
 *
 * Unknown-looking syntax (HTML tags, backslashes, raw braces) renders as
 * plain text. This is deliberate — the chat use case doesn't need image
 * embeds via markdown (those are attachments) or links via `[text](url)`
 * (we autolink instead).
 *
 * ~110 LOC by design. If this grows past ~200, reach for a real parser
 * with a sanitizer (`react-markdown` + `rehype-sanitize`) — but only with
 * an updated XSS test suite.
 */

import type { ReactNode } from "react";
import type { BodyNode } from "./body-parse";

// ---------------------------------------------------------------------------
// Public renderer
// ---------------------------------------------------------------------------

export interface RenderBodyProps {
  /** Output of `parseBody(...)`. */
  nodes: BodyNode[];
}

/**
 * Renders a parsed body to React. Use as `<BodyRenderer nodes={parsed.structuredBody} />`.
 */
export function BodyRenderer({ nodes }: RenderBodyProps): ReactNode {
  // Walk the parsed nodes; for `text` nodes apply markdown-lite formatting
  // inline. mention/autolink nodes render as React components directly.
  const out: ReactNode[] = [];
  let key = 0;
  for (const n of nodes) {
    if (n.kind === "text") {
      out.push(...renderText(n.text, () => key++));
    } else if (n.kind === "mention") {
      out.push(
        <MentionChip key={`m-${key++}`} userId={n.userId} displayName={n.displayName} />
      );
    } else if (n.kind === "autolink") {
      out.push(
        <Autolink key={`l-${key++}`} url={n.url} />
      );
    }
  }
  return <>{out}</>;
}

// ---------------------------------------------------------------------------
// Mention chip + autolink — overridable via React context if a consumer wants
// to wire avatars/popovers later. v1 ships a plain styled chip.
// ---------------------------------------------------------------------------

export function MentionChip({
  userId,
  displayName,
}: {
  userId: string;
  displayName: string;
}) {
  return (
    <span
      data-mention-user-id={userId}
      className="inline-flex items-center rounded bg-accent px-1 font-medium text-accent-foreground"
    >
      @{displayName}
    </span>
  );
}

export function Autolink({ url }: { url: string }) {
  return (
    <a
      href={url}
      rel="noopener noreferrer"
      target="_blank"
      className="text-primary underline underline-offset-2 hover:opacity-80"
    >
      {url}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Text formatter — fenced code, inline code, bold, italic, line breaks.
// ---------------------------------------------------------------------------

const FENCE_RE = /```([\s\S]*?)```/g;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const BOLD_RE = /\*\*([^*\n]+)\*\*/g;
const ITALIC_RE = /\*([^*\n]+)\*/g;

interface Token {
  start: number;
  end: number;
  node: ReactNode;
}

function pushTokens(
  source: string,
  re: RegExp,
  build: (inner: string) => ReactNode,
  tokens: Token[]
) {
  for (const m of source.matchAll(re)) {
    if (m.index === undefined) continue;
    tokens.push({
      start: m.index,
      end: m.index + m[0].length,
      node: build(m[1]),
    });
  }
}

/**
 * Render a single text run with markdown-lite formatting. Emits ReactNodes
 * inline so the caller can interleave them with mention/autolink nodes.
 */
function renderText(text: string, nextKey: () => number): ReactNode[] {
  // Step 1: extract fences. Their content is pre-formatted and shouldn't
  // be re-parsed for inline markers.
  const fences: Token[] = [];
  pushTokens(
    text,
    FENCE_RE,
    (inner) => (
      <pre
        key={`fence-${nextKey()}`}
        className="my-2 overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-sm"
      >
        <code>{inner.replace(/^\n/, "").replace(/\n$/, "")}</code>
      </pre>
    ),
    fences
  );

  // Walk text; for each non-fence span, run the inline formatter.
  const result: ReactNode[] = [];
  let cursor = 0;
  for (const f of fences.sort((a, b) => a.start - b.start)) {
    if (f.start > cursor) {
      result.push(...renderInline(text.slice(cursor, f.start), nextKey));
    }
    result.push(f.node);
    cursor = f.end;
  }
  if (cursor < text.length) {
    result.push(...renderInline(text.slice(cursor), nextKey));
  }
  return result;
}

/**
 * Inline formatting — order matters. Inline-code wins over bold/italic so
 * `` `**not bold**` `` renders as code, not as bold. Bold wins over italic
 * so `**foo**` is bold, not bold-then-italic.
 */
function renderInline(text: string, nextKey: () => number): ReactNode[] {
  const tokens: Token[] = [];

  pushTokens(
    text,
    INLINE_CODE_RE,
    (inner) => (
      <code
        key={`code-${nextKey()}`}
        className="rounded bg-muted px-1 py-0.5 font-mono text-sm"
      >
        {inner}
      </code>
    ),
    tokens
  );
  pushTokens(
    text,
    BOLD_RE,
    (inner) => <strong key={`b-${nextKey()}`}>{inner}</strong>,
    tokens
  );
  pushTokens(
    text,
    ITALIC_RE,
    (inner) => <em key={`i-${nextKey()}`}>{inner}</em>,
    tokens
  );

  // Resolve overlaps left-to-right; the order above is the priority order.
  tokens.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    // For ties, longer match wins (bold over italic).
    return b.end - b.start - (a.end - a.start);
  });
  const filtered: Token[] = [];
  let lastEnd = -1;
  for (const t of tokens) {
    if (t.start < lastEnd) continue;
    filtered.push(t);
    lastEnd = t.end;
  }

  const out: ReactNode[] = [];
  let cursor = 0;
  for (const t of filtered) {
    if (t.start > cursor) {
      out.push(...renderPlainText(text.slice(cursor, t.start), nextKey));
    }
    out.push(t.node);
    cursor = t.end;
  }
  if (cursor < text.length) {
    out.push(...renderPlainText(text.slice(cursor), nextKey));
  }
  return out;
}

/** Plain text + line breaks. */
function renderPlainText(text: string, nextKey: () => number): ReactNode[] {
  if (!text) return [];
  const parts = text.split("\n");
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (part) out.push(<span key={`t-${nextKey()}`}>{part}</span>);
    if (i < parts.length - 1) out.push(<br key={`br-${nextKey()}`} />);
  });
  return out;
}
