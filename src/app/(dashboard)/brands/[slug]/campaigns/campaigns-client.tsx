"use client";

/**
 * Campaigns admin (T145). List + create + delete. Scoped to the brand
 * resolved by the parent server component.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Link from "next/link";
import {
  ChevronRight,
  Loader2,
  Megaphone,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

interface Campaign {
  id: string;
  brandId: string;
  name: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

interface Props {
  brandId: string;
  brandName: string;
  brandSlug: string;
  canManage: boolean;
}

export function CampaignsClient({
  brandId,
  brandName,
  brandSlug,
  canManage,
}: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "" });
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/campaigns?brandId=${brandId}`);
    if (!res.ok) return;
    const data = (await res.json()) as { campaigns: Campaign[] };
    setCampaigns(data.campaigns);
  }, [brandId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function handleCreate() {
    if (!draft.name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          name: draft.name.trim(),
          description: draft.description.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(
          data.error === "campaign_name_collision"
            ? "A campaign with that name already exists"
            : data.error ?? "Failed to create"
        );
        return;
      }
      toast.success("Campaign created");
      setDraft({ name: "", description: "" });
      setCreateOpen(false);
      await refetch();
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Failed to delete");
        return;
      }
      toast.success("Campaign deleted");
      setCampaigns((prev) => (prev ?? []).filter((c) => c.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Campaigns</h2>
          <p className="text-sm text-muted-foreground">
            Group {brandName} assets by initiative for filtering and reporting.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <Plus className="mr-1 h-4 w-4" />
            New campaign
          </Button>
        )}
      </div>

      {campaigns === null ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          <Megaphone className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
          No campaigns yet.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {campaigns.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
            >
              <Link
                href={`/brands/${brandSlug}/campaigns/${c.id}`}
                className="-mx-4 -my-3 flex flex-1 items-center gap-2 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label={`View ${c.name}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.name}</div>
                  {c.description && (
                    <div className="line-clamp-2 text-xs text-muted-foreground">
                      {c.description}
                    </div>
                  )}
                </div>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </Link>
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(c.id)}
                  disabled={deletingId === c.id}
                  aria-label={`Delete ${c.name}`}
                >
                  {deletingId === c.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New campaign</DialogTitle>
            <DialogDescription>
              Campaigns let you group assets in {brandName} by initiative.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="campaign-name">Name</Label>
              <Input
                id="campaign-name"
                autoFocus
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
                placeholder="Spring sale 2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campaign-desc">Description (optional)</Label>
              <Textarea
                id="campaign-desc"
                rows={2}
                value={draft.description}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, description: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !draft.name.trim()}
            >
              {creating && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
