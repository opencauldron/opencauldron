"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ReviewModal,
  type ReviewQueueItem,
} from "@/components/review-modal";
import {
  ReviewTile,
  ReviewGallerySkeleton,
} from "@/components/review-tile";

interface PendingBrand {
  brandId: string;
  brandName: string;
  brandSlug: string;
  brandColor: string;
  pendingCount: number;
}

interface PendingResponse {
  brands: PendingBrand[];
  totalPending: number;
}

interface QueueResponse {
  brand: { id: string; selfApprovalAllowed: boolean };
  queue: ReviewQueueItem[];
}

export function ReviewClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeBrandId = searchParams.get("brand");

  const [pending, setPending] = useState<PendingResponse | null>(null);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState(false);
  const [modalIndex, setModalIndex] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  const refreshPending = useCallback(async () => {
    setPendingLoading(true);
    try {
      const res = await fetch("/api/reviews/pending", { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const data = (await res.json()) as PendingResponse;
      setPending(data);
    } catch {
      toast.error("Couldn't load review queue");
      setPending({ brands: [], totalPending: 0 });
    } finally {
      setPendingLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  const loadQueue = useCallback(
    async (brandId: string) => {
      setQueueLoading(true);
      try {
        const res = await fetch(`/api/reviews/queue/${brandId}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? "failed");
        }
        const data = (await res.json()) as QueueResponse;
        setQueue(data);
        setQueueError(false);
        setModalIndex(0);
        // Gallery-first: do NOT auto-open the modal. Reviewers see the grid,
        // then click a tile to open the modal at that index. (US1, T007)
        if (data.queue.length === 0) {
          toast.message("Queue is empty for this brand.");
        }
      } catch (err) {
        setQueueError(true);
        toast.error(
          err instanceof Error && err.message === "forbidden"
            ? "You can't review this brand."
            : "Couldn't load brand queue"
        );
      } finally {
        setQueueLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    setQueueError(false);
    if (activeBrandId) {
      loadQueue(activeBrandId);
    } else {
      setQueue(null);
      setModalOpen(false);
    }
  }, [activeBrandId, loadQueue]);

  const handleAction = useCallback(
    async (
      action: "approve" | "reject",
      item: ReviewQueueItem,
      note: string | undefined
    ) => {
      try {
        const res = await fetch(`/api/assets/${item.id}/transition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, note }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (body.error === "self_approval_blocked") {
            toast.error("Self-approval is disabled on this brand.");
          } else if (body.error === "invalid_transition") {
            toast.error("This asset is no longer in review.");
          } else {
            toast.error(`Action failed: ${body.error ?? res.statusText}`);
          }
          return;
        }
        toast.success(action === "approve" ? "Approved" : "Rejected");
        // Remove the item from the local queue and advance.
        const remaining = (queue?.queue.length ?? 1) - 1;
        setQueue((prev) => {
          if (!prev) return prev;
          const next = prev.queue.filter((q) => q.id !== item.id);
          return { ...prev, queue: next };
        });
        setModalIndex((i) => {
          if (remaining <= 0) return 0;
          return Math.min(i, remaining - 1);
        });
        // Designer R1: Base UI's Dialog returnFocus targets the originating
        // tile, but that tile is unmounted post-action so focus falls back to
        // <body>. Restore focus to the surviving tile at the modal's index so
        // a keyboard reviewer (Fern) stays in flow. Skip when the queue empties
        // — the queue-empty effect navigates to /review and there is no tile.
        if (remaining > 0) {
          const targetIndex = Math.min(modalIndex, remaining - 1);
          requestAnimationFrame(() => {
            const next = document.querySelector<HTMLButtonElement>(
              `[data-slot="review-tile"][data-index="${targetIndex}"]`
            );
            next?.focus();
          });
        }
        refreshPending();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("opencauldron:review-changed"));
        }
      } catch {
        toast.error("Network error");
      }
    },
    [queue?.queue.length, modalIndex, refreshPending]
  );

  // US2 (T013): Closing the modal returns the reviewer to the gallery (URL
  // stays at /review?brand=<id>). Popping back to the brand list is handled
  // by the queue-empty effect below — only when there is genuinely nothing
  // left to triage in this brand.
  const closeModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  const handleTileClick = useCallback((index: number) => {
    setModalIndex(index);
    setModalOpen(true);
  }, []);

  const handleQueueRetry = useCallback(() => {
    if (!activeBrandId) return;
    setQueueError(false);
    loadQueue(activeBrandId);
  }, [activeBrandId, loadQueue]);

  // If the queue empties while the modal is open (last asset reviewed),
  // close the modal AND pop back to the brand list — there is nothing left
  // to triage in this brand. (US2 / T013, plan.md "Risks & Mitigations".)
  // We key on the primitive length to keep the dep list stable.
  const queueLength = queue?.queue.length ?? null;
  useEffect(() => {
    if (modalOpen && queueLength === 0) {
      setModalOpen(false);
      router.push("/review");
    }
  }, [modalOpen, queueLength, router]);

  const hasBrands = (pending?.brands.length ?? 0) > 0;

  const summary = useMemo(() => {
    if (!pending) return null;
    return `${pending.totalPending} pending across ${pending.brands.filter((b) => b.pendingCount > 0).length} brand${pending.brands.filter((b) => b.pendingCount > 0).length === 1 ? "" : "s"}`;
  }, [pending]);

  return (
    <div className="space-y-6">
      {pendingLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading queue
        </div>
      ) : !hasBrands ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            You aren&apos;t a brand manager on any brand yet. Ask a studio
            admin to add you.
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{summary}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pending!.brands.map((b) => {
              const empty = b.pendingCount === 0;
              return (
                <Card
                  key={b.brandId}
                  className={empty ? "opacity-60" : ""}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base font-semibold">
                      <span
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ backgroundColor: b.brandColor }}
                      />
                      {b.brandName}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between">
                    <div>
                      <div className="font-heading text-2xl font-bold">
                        {b.pendingCount}
                      </div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        {empty ? "All clear" : "pending review"}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={empty ? "outline" : "default"}
                      disabled={empty || queueLoading}
                      onClick={() => router.push(`/review?brand=${b.brandId}`)}
                    >
                      {empty ? (
                        <>
                          <CheckCircle2 className="mr-1 h-4 w-4" />
                          Empty
                        </>
                      ) : (
                        <>
                          Open queue
                          <ChevronRight className="ml-1 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {activeBrandId && (queueLoading || queue || queueError) && (
        <ReviewGallery
          queue={queue?.queue ?? []}
          loading={queueLoading}
          error={queueError}
          onTileClick={handleTileClick}
          onRetry={handleQueueRetry}
        />
      )}

      {queue && (
        <ReviewModal
          open={modalOpen && queue.queue.length > 0}
          queue={queue.queue}
          index={modalIndex}
          onIndexChange={setModalIndex}
          onAction={handleAction}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReviewGallery — co-located, pure-presentational sub-component.
// Owns no state. Renders one of four branches: error, initial-load skeleton,
// empty state, or the responsive grid of ReviewTiles (with a subtle dim during
// refetch). Visual language matches the brand-cards "All clear" treatment
// above so the page reads as one surface.
// ---------------------------------------------------------------------------

interface ReviewGalleryProps {
  queue: ReviewQueueItem[];
  loading: boolean;
  error: boolean;
  onTileClick: (index: number) => void;
  onRetry: () => void;
}

function ReviewGallery({
  queue,
  loading,
  error,
  onTileClick,
  onRetry,
}: ReviewGalleryProps) {
  // Error wins over loading: if the last fetch failed, show the retry card
  // even while the next attempt is in flight (the loading branch will take
  // over once the user clicks retry — handleQueueRetry clears error first).
  if (error) {
    return (
      <Card data-slot="review-gallery-error" role="alert">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle
            className="size-10 text-destructive"
            aria-hidden
          />
          <div className="space-y-1">
            <p className="font-heading text-base font-medium text-foreground">
              Couldn&apos;t load this brand&apos;s queue.
            </p>
            <p className="text-sm text-muted-foreground">
              Something went wrong fetching the items. Try again?
            </p>
          </div>
          <Button onClick={onRetry}>
            <RotateCcw aria-hidden />
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Initial load — no queue data yet. Show the skeleton grid so the page
  // doesn't collapse to nothing while the first fetch is in flight.
  if (loading && queue.length === 0) {
    return <ReviewGallerySkeleton />;
  }

  // Empty (resolved): brand exists but has nothing pending.
  if (queue.length === 0) {
    return (
      <Card data-slot="review-gallery-empty">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <CheckCircle2
            className="size-10 text-muted-foreground"
            aria-hidden
          />
          <div className="space-y-1">
            <p className="font-heading text-base font-medium text-foreground">
              All clear — nothing pending for this brand.
            </p>
            <p className="text-sm text-muted-foreground">
              Pick another brand from the list above to keep triaging.
            </p>
          </div>
          <Button
            variant="outline"
            render={<Link href="/review" />}
            nativeButton={false}
          >
            Back to brands
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Populated grid. Subtle dim during refetch — keeps the user oriented
  // instead of ripping the grid out from under them. (Mirrors the library
  // pattern at library-client.tsx:367-372.)
  return (
    <div
      data-slot="review-gallery"
      className={cn(
        "grid grid-cols-2 gap-3 transition-opacity duration-150 motion-reduce:transition-none sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
        loading && "opacity-70"
      )}
      aria-busy={loading || undefined}
    >
      {queue.map((item, index) => (
        <ReviewTile
          key={item.id}
          item={item}
          index={index}
          onActivate={onTileClick}
        />
      ))}
    </div>
  );
}
