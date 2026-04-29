"use client";

/**
 * useLibraryQuery — single source of truth for the Library's filter+search
 * state. Owns the URL contract and exposes a patch-based mutation API so
 * facets and the search input never reach for `useRouter` / `useSearchParams`
 * directly. Built on `LibraryQueryProvider` so children get a stable context
 * value and tests can swap in a memory-backed implementation.
 *
 * URL contract (Phase 4 — see specs/library-dam/plan.md):
 *
 *   /library
 *     ?q=hero+shot          — text search
 *     &brand=<uuid>         — single brand filter
 *     &campaign=<uuid>      — single campaign filter
 *     &tag=<uuid>           — repeatable; multi-tag
 *     &tagOp=or             — `or` (default) or `and`
 *     &source=generated     — repeatable; one of uploaded/generated/imported
 *     &status=approved      — repeatable; assets.status enum
 *     # mode=               — RESERVED for Phase 5 (semantic/hybrid). Read but
 *                             not acted on by the API yet.
 *
 * Why a provider, not a hook-only API:
 *   - We need stable identity for `setQuery`, `toggleTag`, `clearAll` so
 *     facet popovers can pass them down without forcing re-render trees.
 *   - The mobile sheet stages changes locally before applying — having the
 *     provider as the canonical "live" state lets the sheet diff against it.
 *   - `useTransition` lives once at the provider so URL pushes don't cascade
 *     pending flags to every facet via prop drilling.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AssetSource = "uploaded" | "generated" | "imported";
export type AssetStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "rejected"
  | "archived";
export type TagOp = "or" | "and";

export interface LibraryQuery {
  q: string;
  brand: string | null;
  campaign: string | null;
  tags: string[];
  tagOp: TagOp;
  sources: AssetSource[];
  statuses: AssetStatus[];
}

export interface LibraryQueryContextValue {
  query: LibraryQuery;
  setQuery: (patch: Partial<LibraryQuery>) => void;
  toggleTag: (tagId: string) => void;
  clearAll: () => void;
  resultsCount: number | null;
  setResultsCount: (n: number | null) => void;
  isPending: boolean;
  activeCount: number;
}

const EMPTY_QUERY: LibraryQuery = {
  q: "",
  brand: null,
  campaign: null,
  tags: [],
  tagOp: "or",
  sources: [],
  statuses: [],
};

// Whitelisted vocabularies — defensive parsing, never trust the URL.
const VALID_SOURCES: ReadonlySet<AssetSource> = new Set([
  "uploaded",
  "generated",
  "imported",
]);
const VALID_STATUSES: ReadonlySet<AssetStatus> = new Set([
  "draft",
  "in_review",
  "approved",
  "rejected",
  "archived",
]);

// ---------------------------------------------------------------------------
// URL <-> query (de)serialization
// ---------------------------------------------------------------------------

export function parseLibraryQuery(
  params: URLSearchParams | ReadonlyURLSearchParams
): LibraryQuery {
  const sp =
    params instanceof URLSearchParams
      ? params
      : new URLSearchParams(params.toString());

  const tags = sp.getAll("tag").filter(Boolean);
  const tagOpRaw = sp.get("tagOp");
  const tagOp: TagOp = tagOpRaw === "and" ? "and" : "or";

  const sources = sp
    .getAll("source")
    .filter((s): s is AssetSource =>
      VALID_SOURCES.has(s as AssetSource)
    );
  const statuses = sp
    .getAll("status")
    .filter((s): s is AssetStatus =>
      VALID_STATUSES.has(s as AssetStatus)
    );

  return {
    q: sp.get("q") ?? "",
    brand: sp.get("brand") || null,
    campaign: sp.get("campaign") || null,
    tags,
    tagOp,
    sources,
    statuses,
  };
}

export function serializeLibraryQuery(query: LibraryQuery): URLSearchParams {
  const sp = new URLSearchParams();
  if (query.q) sp.set("q", query.q);
  if (query.brand) sp.set("brand", query.brand);
  if (query.campaign) sp.set("campaign", query.campaign);
  for (const t of query.tags) sp.append("tag", t);
  // Only emit tagOp when AND — OR is the default.
  if (query.tagOp === "and" && query.tags.length > 1) {
    sp.set("tagOp", "and");
  }
  for (const s of query.sources) sp.append("source", s);
  for (const s of query.statuses) sp.append("status", s);
  return sp;
}

export function countActive(query: LibraryQuery): number {
  let n = 0;
  if (query.q) n++;
  if (query.brand) n++;
  if (query.campaign) n++;
  if (query.tags.length > 0) n++;
  if (query.sources.length > 0) n++;
  if (query.statuses.length > 0) n++;
  return n;
}

// `ReadonlyURLSearchParams` is what `useSearchParams()` returns. Type-only —
// we don't import it because the type narrowing in `parseLibraryQuery` works
// against a structural shape that both `URLSearchParams` and the readonly
// version satisfy.
type ReadonlyURLSearchParams = {
  get(name: string): string | null;
  getAll(name: string): string[];
  toString(): string;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const LibraryQueryContext = createContext<LibraryQueryContextValue | null>(
  null
);

export function useLibraryQuery(): LibraryQueryContextValue {
  const ctx = useContext(LibraryQueryContext);
  if (!ctx) {
    throw new Error(
      "useLibraryQuery must be used inside <LibraryQueryProvider>"
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider — URL-synced
// ---------------------------------------------------------------------------

export function LibraryQueryProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Reading the current query is derived from the URL — single source of
  // truth. We `useMemo` over the searchParams string so identity is stable
  // across renders that don't change the URL.
  const query = useMemo(
    () => parseLibraryQuery(searchParams),
    [searchParams]
  );

  // Result count is owned by the consumer (the grid / fetcher) since the
  // total comes back from the API response. We tag every count with the
  // search-params string it was reported for, then derive `null` whenever
  // the URL has moved on. This keeps invalidation as a render-time
  // derivation instead of a setState-in-effect.
  const [reportedCount, setReportedCount] = useState<{
    qs: string;
    total: number;
  } | null>(null);
  const currentQs = searchParams.toString();

  // Track which router mode (push vs replace) the next URL update should use.
  // Default `replace` for chip toggles + search typing — we don't want every
  // keystroke to land in browser history. The mobile sheet's "Apply" flips
  // this once via `applyMobileStaged`.
  const pushNextRef = useRef(false);

  const writeQuery = useCallback(
    (next: LibraryQuery) => {
      const qs = serializeLibraryQuery(next).toString();
      const target = `/library${qs ? `?${qs}` : ""}`;
      const usePush = pushNextRef.current;
      pushNextRef.current = false;
      startTransition(() => {
        if (usePush) router.push(target);
        else router.replace(target);
      });
    },
    [router]
  );

  const setQuery = useCallback(
    (patch: Partial<LibraryQuery>) => {
      // Merge against the *current* parsed URL (not a stale closure).
      const current = parseLibraryQuery(
        new URLSearchParams(window.location.search)
      );
      const next: LibraryQuery = { ...current, ...patch };
      writeQuery(next);
    },
    [writeQuery]
  );

  const toggleTag = useCallback(
    (tagId: string) => {
      const current = parseLibraryQuery(
        new URLSearchParams(window.location.search)
      );
      const has = current.tags.includes(tagId);
      const tags = has
        ? current.tags.filter((t) => t !== tagId)
        : [...current.tags, tagId];
      writeQuery({ ...current, tags });
    },
    [writeQuery]
  );

  const clearAll = useCallback(() => {
    writeQuery(EMPTY_QUERY);
  }, [writeQuery]);

  const activeCount = useMemo(() => countActive(query), [query]);

  // Derived: the reported count is only valid for the URL it was reported
  // for. After the URL moves on, render `null` until the next fetch lands.
  const resultsCount =
    reportedCount && reportedCount.qs === currentQs
      ? reportedCount.total
      : null;

  const setResultsCount = useCallback((n: number | null) => {
    if (n === null) {
      setReportedCount(null);
      return;
    }
    // Pin to the URL string at the time of report so a stale fetch landing
    // after a filter change doesn't blip the wrong number into the summary.
    const qs =
      typeof window === "undefined"
        ? ""
        : new URLSearchParams(window.location.search).toString();
    setReportedCount({ qs, total: n });
  }, []);

  const value = useMemo<LibraryQueryContextValue>(
    () => ({
      query,
      setQuery,
      toggleTag,
      clearAll,
      resultsCount,
      setResultsCount,
      isPending,
      activeCount,
    }),
    [
      query,
      setQuery,
      toggleTag,
      clearAll,
      resultsCount,
      setResultsCount,
      isPending,
      activeCount,
    ]
  );

  return (
    <LibraryQueryContext.Provider value={value}>
      {children}
    </LibraryQueryContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Memory-backed provider for tests + the mobile sheet's staged state.
// ---------------------------------------------------------------------------

export function MemoryLibraryQueryProvider({
  initial = EMPTY_QUERY,
  children,
}: {
  initial?: LibraryQuery;
  children: ReactNode;
}) {
  const [query, setQueryState] = useState<LibraryQuery>(initial);
  const [resultsCount, setResultsCount] = useState<number | null>(null);

  const setQuery = useCallback((patch: Partial<LibraryQuery>) => {
    setQueryState((prev) => ({ ...prev, ...patch }));
  }, []);

  const toggleTag = useCallback((tagId: string) => {
    setQueryState((prev) => {
      const has = prev.tags.includes(tagId);
      return {
        ...prev,
        tags: has ? prev.tags.filter((t) => t !== tagId) : [...prev.tags, tagId],
      };
    });
  }, []);

  const clearAll = useCallback(() => {
    setQueryState(EMPTY_QUERY);
  }, []);

  const activeCount = useMemo(() => countActive(query), [query]);

  const value = useMemo<LibraryQueryContextValue>(
    () => ({
      query,
      setQuery,
      toggleTag,
      clearAll,
      resultsCount,
      setResultsCount,
      isPending: false,
      activeCount,
    }),
    [query, setQuery, toggleTag, clearAll, resultsCount, activeCount]
  );

  return (
    <LibraryQueryContext.Provider value={value}>
      {children}
    </LibraryQueryContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Helpers (exported for tests + filter-bar consumers)
// ---------------------------------------------------------------------------

export const EMPTY_LIBRARY_QUERY = EMPTY_QUERY;
