"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Download,
  Trash2,
  ImagePlus,
  Loader2,
  Wand2,
  Hash,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface ReferenceItem {
  id: string;
  userId: string;
  url: string;
  thumbnailUrl: string;
  fileName: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  mimeType: string;
  usageCount: number;
  createdAt: string;
}

export function ReferencesClient() {
  const router = useRouter();
  const [refs, setRefs] = useState<ReferenceItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedRef, setSelectedRef] = useState<ReferenceItem | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchRefs = useCallback(
    async (cursor?: string) => {
      if (cursor) setLoadingMore(true);
      else setLoading(true);

      try {
        const params = new URLSearchParams({ limit: "30" });
        if (cursor) params.set("cursor", cursor);

        const res = await fetch(`/api/references?${params}`);
        if (!res.ok) throw new Error();
        const data = await res.json();

        if (cursor) {
          setRefs((prev) => [...prev, ...data.references]);
        } else {
          setRefs(data.references);
        }
        setNextCursor(data.nextCursor);
      } catch {
        toast.error("Failed to load references");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchRefs();
  }, [fetchRefs]);

  // Infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && nextCursor && !loadingMore) {
          fetchRefs(nextCursor);
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextCursor, loadingMore, fetchRefs]);

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/references/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setRefs((prev) => prev.filter((r) => r.id !== id));
      toast.success("Reference deleted");
      setDeleteConfirm(null);
      if (selectedRef?.id === id) setSelectedRef(null);
    } catch {
      toast.error("Failed to delete reference");
    } finally {
      setDeleting(false);
    }
  };

  const handleUse = (ref: ReferenceItem) => {
    const params = new URLSearchParams({ imageInput: ref.url });
    router.push(`/generate?${params.toString()}`);
  };

  const handleDownload = (ref: ReferenceItem) => {
    const a = document.createElement("a");
    a.href = ref.url;
    a.download = ref.fileName ?? `reference-${ref.id.slice(0, 8)}.png`;
    a.click();
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-lg" />
        ))}
      </div>
    );
  }

  if (refs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mb-4">
          <ImagePlus className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">No reference images yet</h3>
        <p className="text-muted-foreground mt-1 max-w-sm">
          Upload a reference image on the Generate page and it will appear here
          for easy reuse.
        </p>
        <Button className="mt-4" onClick={() => router.push("/generate")}>
          <Wand2 className="h-4 w-4 mr-1.5" />
          Go to Generate
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {refs.map((ref) => (
          <ReferenceCard
            key={ref.id}
            ref_={ref}
            onClick={() => setSelectedRef(ref)}
          />
        ))}
      </div>

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-4" />
      {loadingMore && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Detail Dialog */}
      {/*
        TODO(threads): wire ThreadPanel into this Dialog once references
        either (a) move into the `assets` table, or (b) get their own
        permissions helper + thread schema. The current `asset_threads.asset_id
        → assets.id` FK and `assertWorkspaceMemberForAsset` lookup don't cover
        the `references` table, so adding the Thread tab here would 404 from
        every API route. Out of scope for the cross-surface threads rollout.
      */}
      <Dialog
        open={!!selectedRef}
        onOpenChange={(open) => {
          if (!open) setSelectedRef(null);
        }}
      >
        {selectedRef && (
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="truncate">
                {selectedRef.fileName ?? "Reference Image"}
              </DialogTitle>
              <DialogDescription>
                Uploaded{" "}
                {new Date(selectedRef.createdAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Image preview */}
              <div className="rounded-lg overflow-hidden bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedRef.url}
                  alt={selectedRef.fileName ?? "Reference"}
                  className="w-full max-h-[50vh] object-contain"
                />
              </div>

              {/* Metadata */}
              <div className="flex flex-wrap gap-2">
                {selectedRef.width && selectedRef.height && (
                  <Badge variant="secondary">
                    {selectedRef.width} x {selectedRef.height}
                  </Badge>
                )}
                {selectedRef.fileSize && (
                  <Badge variant="secondary">
                    {formatFileSize(selectedRef.fileSize)}
                  </Badge>
                )}
                <Badge variant="secondary">{selectedRef.mimeType}</Badge>
                <Badge variant="outline" className="gap-1">
                  <Hash className="h-3 w-3" />
                  Used {selectedRef.usageCount}{" "}
                  {selectedRef.usageCount === 1 ? "time" : "times"}
                </Badge>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => handleUse(selectedRef)}>
                <Wand2 className="size-4 mr-1.5" />
                Use
              </Button>
              <Button
                variant="outline"
                onClick={() => handleDownload(selectedRef)}
              >
                <Download className="size-4 mr-1.5" />
                Download
              </Button>
              <Button
                variant="destructive"
                onClick={() => setDeleteConfirm(selectedRef.id)}
              >
                <Trash2 className="size-4 mr-1.5" />
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog
        open={!!deleteConfirm}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirm(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete reference?</DialogTitle>
            <DialogDescription>
              This will permanently delete this reference image from storage.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="size-4 mr-1.5 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -------------------------------------------------------------------
// Reference Card
// -------------------------------------------------------------------

function ReferenceCard({
  ref_,
  onClick,
}: {
  ref_: ReferenceItem;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-lg bg-muted text-left cursor-pointer transition-all hover:ring-2 hover:ring-ring/50 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="aspect-square relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ref_.thumbnailUrl}
          alt={ref_.fileName ?? "Reference"}
          className="h-full w-full object-cover"
          loading="lazy"
        />

        {/* Usage count badge */}
        {ref_.usageCount > 0 && (
          <div className="absolute top-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums backdrop-blur-sm flex items-center gap-0.5">
            <Hash className="h-2.5 w-2.5" />
            {ref_.usageCount}
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/20 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
          {ref_.fileName && (
            <p className="line-clamp-1 text-xs text-white/90">
              {ref_.fileName}
            </p>
          )}
          <div className="mt-1 flex items-center gap-1.5">
            {ref_.width && ref_.height && (
              <Badge
                variant="secondary"
                className="text-[10px] bg-white/20 text-white border-0"
              >
                {ref_.width}x{ref_.height}
              </Badge>
            )}
            {ref_.fileSize && (
              <Badge
                variant="secondary"
                className="text-[10px] bg-white/20 text-white border-0"
              >
                {formatFileSize(ref_.fileSize)}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
