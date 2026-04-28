"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ReviewModal,
  type ReviewQueueItem,
} from "@/components/review-modal";

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
        setModalIndex(0);
        setModalOpen(data.queue.length > 0);
        if (data.queue.length === 0) {
          toast.message("Queue is empty for this brand.");
        }
      } catch (err) {
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
        setQueue((prev) => {
          if (!prev) return prev;
          const next = prev.queue.filter((q) => q.id !== item.id);
          return { ...prev, queue: next };
        });
        setModalIndex((i) => {
          const remaining = (queue?.queue.length ?? 1) - 1;
          if (remaining <= 0) return 0;
          return Math.min(i, remaining - 1);
        });
        refreshPending();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("opencauldron:review-changed"));
        }
      } catch {
        toast.error("Network error");
      }
    },
    [queue?.queue.length, refreshPending]
  );

  const closeModal = useCallback(() => {
    setModalOpen(false);
    router.push("/review");
  }, [router]);

  // If queue empties mid-session, close.
  useEffect(() => {
    if (modalOpen && queue && queue.queue.length === 0) {
      setModalOpen(false);
    }
  }, [modalOpen, queue]);

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
