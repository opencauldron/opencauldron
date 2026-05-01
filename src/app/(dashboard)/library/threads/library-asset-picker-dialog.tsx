"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Hash,
  Loader2,
  Search,
  Sparkles,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Library asset picker dialog (T049).
//
// Reuse strategy: this dialog talks directly to the existing `/api/library`
// endpoint rather than wrapping `<LibraryClient>` for "picker mode." Two
// reasons:
//   1. `<LibraryClient>` is URL-state driven (`useLibraryQuery` provider)
//      and pulls in filter chips + facet sheets the picker doesn't need.
//      A scoped picker should not push `?q=...` into the URL.
//   2. The picker only needs the search-input + thumbnail grid + Select
//      action; the rest of the library client (status filters, source
//      filters, brand pinning) is overhead for this surface.
//
// API contract: `GET /api/library?q=<query>&limit=24` (workspace scoping is
// enforced server-side via the session — the route already binds to the
// current user's workspace via `getCurrentWorkspace`). When the route is
// gated behind `LIBRARY_DAM_ENABLED=false` the dialog renders a friendly
// "library not available" empty state.
// ---------------------------------------------------------------------------

interface PickerAsset {
  id: string;
  url: string;
  thumbnailUrl: string;
  fileName: string | null;
  source: "uploaded" | "generated" | "imported";
  mediaType: "image" | "video";
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface LibraryAssetPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: { assetId: string; displayName: string | null }) => void;
}

const LIMIT = 24;

export function LibraryAssetPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: LibraryAssetPickerDialogProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  // Single state object → resets are one synchronous setState in the async
  // callback (the lint rule rejects multi-setState-in-effect-body).
  type FetchState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; items: PickerAsset[] }
    | { status: "error"; message: string };
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  // Debounce the search input — every keystroke shouldn't fan out an FTS
  // query. 200ms is the same step we use elsewhere for typeahead.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setDebouncedQuery(query), 200);
    return () => window.clearTimeout(id);
  }, [query, open]);

  // Reset on close. Setting `prevOpen` alongside drives the reset via the
  // previous-prop pattern instead of a setState-in-effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setQuery("");
      setDebouncedQuery("");
      setFetchState({ status: "idle" });
    }
  }

  // Fetch the page when the dialog is open and the debounced query changes.
  // Abort in-flight on a newer query so a slow response can't replace fresh.
  // The first synchronous step (state → loading) happens *inside* the async
  // closure rather than the effect body, satisfying `react-hooks/set-state-in-effect`.
  useEffect(() => {
    if (!open) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const url = new URL("/api/library", window.location.origin);
    url.searchParams.set("limit", String(LIMIT));
    if (debouncedQuery) url.searchParams.set("q", debouncedQuery);

    (async () => {
      setFetchState({ status: "loading" });
      try {
        const res = await fetch(url.toString(), { signal: ctrl.signal });
        if (!res.ok) {
          if (res.status === 404) {
            setFetchState({
              status: "error",
              message: "Library isn't enabled in this workspace yet.",
            });
            return;
          }
          setFetchState({
            status: "error",
            message: "Couldn't load the library. Try again.",
          });
          return;
        }
        const json = (await res.json()) as { items: PickerAsset[] };
        if (ctrl.signal.aborted) return;
        setFetchState({ status: "ready", items: json.items ?? [] });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFetchState({
          status: "error",
          message: "Couldn't load the library. Try again.",
        });
      }
    })();

    return () => ctrl.abort();
  }, [debouncedQuery, open]);

  const onPick = useCallback(
    (asset: PickerAsset) => {
      onSelect({
        assetId: asset.id,
        displayName: asset.fileName,
      });
      onOpenChange(false);
    },
    [onSelect, onOpenChange]
  );

  const loading = fetchState.status === "loading";
  const error = fetchState.status === "error" ? fetchState.message : null;
  const items = fetchState.status === "ready" ? fetchState.items : [];
  const empty = !loading && items.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[80vh] max-h-[640px] w-full max-w-2xl flex-col gap-3 overflow-hidden p-0 sm:max-w-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 pb-3 pt-4">
          <div>
            <DialogTitle>Attach from Library</DialogTitle>
            <DialogDescription>
              Pick an asset from your workspace — it&apos;ll render as a card
              in the message.
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenChange(false)}
            aria-label="Close picker"
          >
            <X aria-hidden />
          </Button>
        </div>

        <div className="px-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by filename, tag, or campaign…"
              aria-label="Search library"
              className="pl-8"
            />
            {loading ? (
              <Loader2
                className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
                aria-hidden
              />
            ) : null}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {error ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              {error}
            </div>
          ) : empty ? (
            <PickerEmpty hasQuery={!!debouncedQuery} />
          ) : (
            <PickerGrid items={items} onPick={onPick} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sub-pieces
// ---------------------------------------------------------------------------

function PickerGrid({
  items,
  onPick,
}: {
  items: PickerAsset[];
  onPick: (asset: PickerAsset) => void;
}) {
  return (
    <ul
      role="listbox"
      aria-label="Library results"
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4"
    >
      {items.map((a) => (
        <li key={a.id}>
          <PickerCard asset={a} onPick={() => onPick(a)} />
        </li>
      ))}
    </ul>
  );
}

function PickerCard({
  asset,
  onPick,
}: {
  asset: PickerAsset;
  onPick: () => void;
}) {
  const sourceLabel = useMemo(() => {
    return asset.source === "generated"
      ? "Generated"
      : asset.source === "imported"
        ? "Imported"
        : "Uploaded";
  }, [asset.source]);
  const SourceIcon =
    asset.source === "generated"
      ? Wand2
      : asset.source === "imported"
        ? Sparkles
        : Upload;

  return (
    <button
      type="button"
      onClick={onPick}
      data-slot="picker-card"
      className={cn(
        "group/card relative block w-full overflow-hidden rounded-lg bg-muted text-left",
        "ring-1 ring-foreground/10 transition-all",
        "hover:-translate-y-0.5 hover:shadow-lg hover:ring-primary/40",
        "active:translate-y-px",
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
      )}
      aria-label={`Select ${asset.fileName ?? "asset"} ${asset.id.slice(0, 8)}`}
    >
      <div className="relative aspect-square">
        {asset.mediaType === "video" ? (
          <video
            src={asset.url}
            muted
            playsInline
            preload="metadata"
            className="size-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.thumbnailUrl}
            alt={asset.fileName ?? "Asset thumbnail"}
            className="size-full object-cover"
            loading="lazy"
            decoding="async"
          />
        )}
        <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-md bg-background/85 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground backdrop-blur-sm">
          <SourceIcon className="size-2.5" aria-hidden />
          {sourceLabel}
        </span>
      </div>
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <Hash className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate text-xs text-foreground">
          {asset.fileName ?? "Untitled asset"}
        </span>
      </div>
    </button>
  );
}

function PickerEmpty({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-1.5 text-center">
      <p className="text-sm font-medium text-foreground">
        {hasQuery ? "Nothing matches that search." : "No assets yet."}
      </p>
      <p className="text-xs text-muted-foreground">
        {hasQuery
          ? "Try a different filename or tag."
          : "Upload or generate something first, then attach it here."}
      </p>
    </div>
  );
}
