/**
 * Pure body parser (T010).
 *
 * Inputs:
 *   - rawBody:        the user's typed text
 *   - workspaceMembers: candidate users for `@`-mention resolution
 *
 * Outputs:
 *   - structuredBody: a flat array of nodes the renderer can walk (text,
 *     mention, autolink). NOT a markdown AST — markdown formatting is
 *     handled inline by the renderer (T011); the parser only needs to know
 *     about the structures that touch DB state (mentions) or are too easy
 *     to mis-render unsafely (autolinks).
 *   - mentions:        unique `{ userId }[]` for fan-out + storage. Order
 *     matches first occurrence; duplicates (same user mentioned twice in one
 *     message) collapse to a single notification.
 *   - links:          unique `{ url }[]` extracted from autolink scan. Used
 *     by the renderer; not stored in DB.
 *
 * Pure: no DB access, no I/O, deterministic. Unit-testable.
 */

export interface BodyMember {
  id: string;
  /** Lowercased handle used to match `@<handle>`. */
  handle: string;
  displayName: string;
}

export type BodyNode =
  | { kind: "text"; text: string }
  | { kind: "mention"; userId: string; displayName: string; handle: string }
  | { kind: "autolink"; url: string };

export interface ParsedBody {
  structuredBody: BodyNode[];
  mentions: { userId: string }[];
  links: { url: string }[];
}

/**
 * Mention regex — `@` followed by 1..32 chars of `[A-Za-z0-9._-]`. Matches
 * Discord/GitHub-ish handles. The trailing punctuation (`.`, `,`, etc.) is
 * NOT consumed, so `@sasha,` correctly mentions `sasha` and leaves the
 * comma in the surrounding text.
 */
const MENTION_RE = /@([A-Za-z0-9_][A-Za-z0-9._-]{0,31})/g;

/**
 * URL autolink — bare http(s) URLs. Punctuation cleanup at the end so a URL
 * pasted inline like `see https://example.com.` doesn't capture the period.
 */
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/g;
const TRAILING_PUNCT = /[)\].,;:!?]+$/;

/**
 * Derive a lowercase handle from a member's display name or email-style id.
 * The route layer should pass real handles when available; this is a fallback
 * so the unit tests can exercise the parser with simple inputs.
 */
export function deriveHandle(displayName: string): string {
  return displayName.toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

/**
 * Replace every `@handle` and bare URL in `rawBody` with a structured node.
 * Plain text between matches is preserved exactly (whitespace, punctuation).
 */
export function parseBody(
  rawBody: string,
  workspaceMembers: BodyMember[]
): ParsedBody {
  // Build a handle → member map once. Handles are case-insensitive.
  const memberByHandle = new Map<string, BodyMember>();
  for (const m of workspaceMembers) {
    memberByHandle.set(m.handle.toLowerCase(), m);
  }

  // Collect all matches (mention + url) into a single sorted array, then
  // walk the body in one pass emitting text-or-node alternation.
  type Match = {
    start: number;
    end: number;
    node: BodyNode;
  };
  const matches: Match[] = [];

  for (const m of rawBody.matchAll(MENTION_RE)) {
    const handle = m[1].toLowerCase();
    const member = memberByHandle.get(handle);
    if (!member) continue; // Don't render unknown handles as mentions.
    if (m.index === undefined) continue;
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      node: {
        kind: "mention",
        userId: member.id,
        displayName: member.displayName,
        handle: member.handle,
      },
    });
  }

  for (const m of rawBody.matchAll(URL_RE)) {
    if (m.index === undefined) continue;
    let raw = m[0];
    let end = m.index + raw.length;
    const trail = raw.match(TRAILING_PUNCT);
    if (trail) {
      raw = raw.slice(0, raw.length - trail[0].length);
      end -= trail[0].length;
    }
    matches.push({
      start: m.index,
      end,
      node: { kind: "autolink", url: raw },
    });
  }

  matches.sort((a, b) => a.start - b.start);

  // Merge — drop overlapping matches (mentions win over autolinks because
  // we add them first; sort is stable).
  const filtered: Match[] = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start < lastEnd) continue;
    filtered.push(m);
    lastEnd = m.end;
  }

  const nodes: BodyNode[] = [];
  let cursor = 0;
  for (const m of filtered) {
    if (m.start > cursor) {
      nodes.push({ kind: "text", text: rawBody.slice(cursor, m.start) });
    }
    nodes.push(m.node);
    cursor = m.end;
  }
  if (cursor < rawBody.length) {
    nodes.push({ kind: "text", text: rawBody.slice(cursor) });
  }

  // Dedupe mentions + links. Cap mentions at 10 unique users (spec mention
  // storm guard) — extra mentions still render, just don't fan out.
  const mentionSeen = new Set<string>();
  const mentions: { userId: string }[] = [];
  for (const n of nodes) {
    if (n.kind === "mention" && !mentionSeen.has(n.userId)) {
      mentionSeen.add(n.userId);
      mentions.push({ userId: n.userId });
      if (mentions.length >= 10) break;
    }
  }

  const linkSeen = new Set<string>();
  const links: { url: string }[] = [];
  for (const n of nodes) {
    if (n.kind === "autolink" && !linkSeen.has(n.url)) {
      linkSeen.add(n.url);
      links.push({ url: n.url });
    }
  }

  return { structuredBody: nodes, mentions, links };
}
