"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  FlaskConical,
  Pencil,
  Trash2,
  ArrowRight,
  Layers,
  Wand2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type { Brew } from "@/types";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BrewsClient() {
  const router = useRouter();
  const [brews, setBrews] = useState<Brew[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Edit dialog
  const [editBrew, setEditBrew] = useState<Brew | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Delete dialog
  const [deleteBrew, setDeleteBrew] = useState<Brew | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // -----------------------------------------------------------------------
  // Fetch brews
  // -----------------------------------------------------------------------

  useEffect(() => {
    fetch("/api/brews")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { brews: Brew[] }) => {
        setBrews(data.brews ?? []);
      })
      .catch(() => {
        toast.error("Failed to load brews");
      })
      .finally(() => setIsLoading(false));
  }, []);

  // -----------------------------------------------------------------------
  // Edit
  // -----------------------------------------------------------------------

  const openEdit = useCallback((brew: Brew) => {
    setEditBrew(brew);
    setEditName(brew.name);
    setEditDescription(brew.description ?? "");
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editBrew || !editName.trim()) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/brews/${editBrew.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
        }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { brew: Brew };
      setBrews((prev) => prev.map((b) => (b.id === data.brew.id ? data.brew : b)));
      setEditBrew(null);
      toast.success("Brew updated");
    } catch {
      toast.error("Failed to update brew");
    } finally {
      setIsSaving(false);
    }
  }, [editBrew, editName, editDescription]);

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------

  const handleDelete = useCallback(async () => {
    if (!deleteBrew) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/brews/${deleteBrew.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setBrews((prev) => prev.filter((b) => b.id !== deleteBrew.id));
      setDeleteBrew(null);
      toast.success("Brew deleted");
    } catch {
      toast.error("Failed to delete brew");
    } finally {
      setIsDeleting(false);
    }
  }, [deleteBrew]);

  // -----------------------------------------------------------------------
  // Use brew — navigate to generate page with brew ID in query
  // -----------------------------------------------------------------------

  const handleUse = useCallback(
    (brew: Brew) => {
      router.push(`/generate?brew=${brew.id}`);
    },
    [router]
  );

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-border/40 p-4">
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (brews.length === 0) {
    return (
      <div className="text-center py-20 space-y-3">
        <FlaskConical className="h-10 w-10 mx-auto text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No brews yet</p>
        <p className="text-xs text-muted-foreground/60">
          Generate an image, then click "Save as Brew" to save the recipe for reuse.
        </p>
        <Button variant="outline" size="sm" onClick={() => router.push("/generate")}>
          <Wand2 className="h-3.5 w-3.5 mr-1.5" />
          Go to Generate
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {brews.map((brew) => {
          const params = brew.parameters as Record<string, unknown> | null;
          const loras = params?.loras as Array<{ path: string; scale: number }> | undefined;
          const loraCount = loras?.length ?? 0;

          return (
            <div
              key={brew.id}
              className="group relative rounded-xl border border-border/40 bg-card overflow-hidden transition-all duration-200 hover:border-border hover:shadow-md"
            >
              {/* Preview */}
              <div className="aspect-video bg-muted/20 overflow-hidden">
                {brew.previewUrl ? (
                  <img
                    src={brew.previewUrl}
                    alt=""
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center">
                    <FlaskConical className="h-8 w-8 text-muted-foreground/15" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-medium leading-tight line-clamp-1">
                    {brew.name}
                  </h3>
                  <Badge variant="outline" className="text-[9px] shrink-0">
                    {brew.model}
                  </Badge>
                </div>

                {brew.description ? (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {brew.description}
                  </p>
                ) : null}

                {brew.prompt ? (
                  <p className="text-xs text-muted-foreground/60 line-clamp-1 italic">
                    "{brew.prompt}"
                  </p>
                ) : null}

                {/* Meta badges */}
                <div className="flex flex-wrap gap-1.5">
                  {loraCount > 0 ? (
                    <Badge variant="secondary" className="text-[9px] gap-1 font-normal">
                      <Layers className="h-2.5 w-2.5" />
                      {loraCount} LoRA{loraCount > 1 ? "s" : ""}
                    </Badge>
                  ) : null}
                  {brew.usageCount > 0 ? (
                    <Badge variant="outline" className="text-[9px] font-normal">
                      Used {brew.usageCount}x
                    </Badge>
                  ) : null}
                </div>

                {/* Actions */}
                <div className="flex gap-1.5 pt-1">
                  <Button
                    size="sm"
                    className="flex-1 h-7 text-xs gap-1 cursor-pointer"
                    onClick={() => handleUse(brew)}
                  >
                    <ArrowRight className="h-3 w-3" />
                    Use
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 cursor-pointer"
                    onClick={() => openEdit(brew)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive cursor-pointer"
                    onClick={() => setDeleteBrew(brew)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editBrew} onOpenChange={(open) => { if (!open) setEditBrew(null); }}>
        {editBrew ? (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Brew</DialogTitle>
              <DialogDescription>Update the name and description.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="brew-name">Name</Label>
                <Input
                  id="brew-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="My Brew"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="brew-desc">Description</Label>
                <Textarea
                  id="brew-desc"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Optional description..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditBrew(null)}>Cancel</Button>
              <Button onClick={handleSaveEdit} disabled={!editName.trim() || isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteBrew} onOpenChange={(open) => { if (!open) setDeleteBrew(null); }}>
        {deleteBrew ? (
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete Brew</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete "{deleteBrew.name}"? This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteBrew(null)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
