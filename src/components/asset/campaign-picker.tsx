"use client";

import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Loader2,
  Megaphone,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface CampaignOption {
  id: string;
  name: string;
}

export interface CampaignTag {
  id: string;
  name: string;
}

interface CampaignPickerProps {
  assetId: string;
  brandId: string | null;
  campaigns: CampaignTag[];
  onChange?: (next: CampaignTag[]) => void;
  hideWhenEmptyBrand?: boolean;
}

interface MeResponse {
  userId: string | null;
  role: "owner" | "admin" | "member" | null;
  brandRoles: Record<string, "brand_manager" | "creator" | "viewer">;
}

let cachedMe: MeResponse | null = null;
let inflightMe: Promise<MeResponse | null> | null = null;

function fetchMe(): Promise<MeResponse | null> {
  if (cachedMe) return Promise.resolve(cachedMe);
  if (inflightMe) return inflightMe;
  inflightMe = fetch("/api/me")
    .then((r) => (r.ok ? r.json() : null))
    .then((data: MeResponse | null) => {
      if (data) cachedMe = data;
      inflightMe = null;
      return data;
    })
    .catch(() => {
      inflightMe = null;
      return null;
    });
  return inflightMe;
}

function isBrandCreatorClient(me: MeResponse | null, brandId: string): boolean {
  if (!me) return false;
  if (me.role === "owner" || me.role === "admin") return true;
  const r = me.brandRoles[brandId];
  return r === "brand_manager" || r === "creator";
}

export function CampaignPicker({
  assetId,
  brandId,
  campaigns,
  onChange,
  hideWhenEmptyBrand = true,
}: CampaignPickerProps) {
  const [me, setMe] = useState<MeResponse | null>(cachedMe);
  const [meLoaded, setMeLoaded] = useState<boolean>(cachedMe !== null);

  useEffect(() => {
    if (meLoaded) return;
    let cancelled = false;
    fetchMe().then((data) => {
      if (cancelled) return;
      setMe(data);
      setMeLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [meLoaded]);

  const [selected, setSelected] = useState<CampaignTag[]>(campaigns);
  const [seenAssetId, setSeenAssetId] = useState(assetId);
  if (seenAssetId !== assetId) {
    setSeenAssetId(assetId);
    setSelected(campaigns);
  }

  const [options, setOptions] = useState<CampaignOption[] | null>(null);
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !brandId) return;
    let cancelled = false;
    fetch(`/api/campaigns?brandId=${brandId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const rows = Array.isArray(data.campaigns) ? data.campaigns : [];
        setOptions(
          rows.map((c: { id: string; name: string }) => ({
            id: c.id,
            name: c.name,
          }))
        );
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, brandId]);

  if (!meLoaded) return null;
  if (!brandId) {
    if (hideWhenEmptyBrand) return null;
    return (
      <div className="flex flex-col gap-2">
        <Label>Campaigns</Label>
        <p className="text-xs text-muted-foreground">
          This asset isn&apos;t on a brand, so it can&apos;t be added to a
          campaign.
        </p>
      </div>
    );
  }
  if (!isBrandCreatorClient(me, brandId)) return null;

  const persist = async (next: CampaignTag[], pending: string) => {
    setPendingId(pending);
    const ok = await patchAssetCampaigns(
      assetId,
      next.map((c) => c.id)
    );
    setPendingId(null);
    return ok;
  };

  const handleToggle = async (option: CampaignOption) => {
    const exists = selected.some((c) => c.id === option.id);
    const next = exists
      ? selected.filter((c) => c.id !== option.id)
      : [...selected, { id: option.id, name: option.name }];
    const ok = await persist(next, option.id);
    if (!ok) {
      toast.error("Couldn't update campaigns. Try again.");
      return;
    }
    setSelected(next);
    onChange?.(next);
  };

  const handleRemoveChip = async (campaignId: string) => {
    const next = selected.filter((c) => c.id !== campaignId);
    const ok = await persist(next, campaignId);
    if (!ok) {
      toast.error("Couldn't remove campaign. Try again.");
      return;
    }
    setSelected(next);
    onChange?.(next);
  };

  const handleCreated = async (campaign: CampaignOption) => {
    setOptions((prev) => (prev ? [...prev, campaign] : [campaign]));
    const next = [...selected, { id: campaign.id, name: campaign.name }];
    const ok = await persist(next, campaign.id);
    if (ok) {
      setSelected(next);
      onChange?.(next);
    }
  };

  const trimmed = search.trim().toLowerCase();
  const filtered = (options ?? []).filter((c) =>
    trimmed.length === 0 ? true : c.name.toLowerCase().includes(trimmed)
  );

  return (
    <div className="flex flex-col gap-2">
      <Label>Campaigns</Label>

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => handleRemoveChip(c.id)}
              disabled={pendingId === c.id}
              className={cn(
                "group/chip inline-flex h-6 items-center gap-1 rounded-md bg-primary/10 px-2 text-xs font-medium text-primary ring-1 ring-primary/25 transition-colors",
                "hover:bg-destructive/10 hover:text-destructive hover:ring-destructive/30",
                "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                pendingId === c.id && "opacity-60"
              )}
              aria-label={`Remove campaign ${c.name}`}
            >
              <Megaphone
                className="size-3 text-current opacity-70"
                aria-hidden
              />
              <span>{c.name}</span>
              {pendingId === c.id ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : (
                <X
                  className="size-3 opacity-60 transition-opacity group-hover/chip:opacity-100"
                  aria-hidden
                />
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Group assets by campaign to keep launches organized.
        </p>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-between gap-2"
              aria-label="Add to campaign"
            >
              <span className="text-muted-foreground">Add to campaign…</span>
              <ChevronDown
                className="size-3.5 text-muted-foreground"
                aria-hidden
              />
            </Button>
          }
        />
        <PopoverContent align="start" className="w-72 p-0">
          <div className="border-b border-border p-1">
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search campaigns…"
              className="h-8 border-none bg-transparent px-2 text-sm shadow-none focus-visible:border-none focus-visible:ring-0"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {options === null ? (
              <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                {trimmed ? "No matches." : "No campaigns yet on this brand."}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {filtered.map((c) => {
                  const checked = selected.some((x) => x.id === c.id);
                  const busy = pendingId === c.id;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => handleToggle(c)}
                        disabled={busy}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                          "hover:bg-accent",
                          checked && "bg-primary/10 text-primary",
                          busy && "opacity-60"
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "flex size-4 items-center justify-center rounded-sm border",
                            checked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-foreground/25"
                          )}
                        >
                          {checked && <Check className="size-3" aria-hidden />}
                        </span>
                        <Megaphone
                          className="size-3.5 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="flex-1 truncate">{c.name}</span>
                        {busy && (
                          <Loader2
                            className="size-3 animate-spin text-muted-foreground"
                            aria-hidden
                          />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="border-t border-border p-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                "hover:bg-accent text-muted-foreground hover:text-foreground"
              )}
            >
              <Plus className="size-3.5" aria-hidden />
              New campaign
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <CreateCampaignDialog
        open={createOpen}
        brandId={brandId}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />
    </div>
  );
}

async function patchAssetCampaigns(
  id: string,
  campaignIds: string[]
): Promise<boolean> {
  try {
    const res = await fetch(`/api/assets/${id}/campaigns`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignIds }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function CreateCampaignDialog({
  open,
  brandId,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  brandId: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (campaign: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setName("");
      setDescription("");
    }
  }

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          name: trimmed,
          description: description.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(
          data.error === "campaign_name_collision"
            ? "A campaign with that name already exists."
            : data.error === "forbidden"
              ? "You don't have permission to create campaigns on this brand."
              : "Couldn't create campaign. Try again."
        );
        return;
      }
      const data = (await res.json()) as {
        campaign: { id: string; name: string };
      };
      toast.success("Campaign created");
      onCreated({ id: data.campaign.id, name: data.campaign.name });
      onOpenChange(false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>
            Group assets under a launch, drop, or initiative.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-campaign-name">Name</Label>
            <Input
              id="new-campaign-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Spring sale 2026"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !creating && name.trim()) {
                  e.preventDefault();
                  handleCreate();
                }
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-campaign-desc">Description (optional)</Label>
            <Textarea
              id="new-campaign-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating || !name.trim()}>
            {creating ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Creating…
              </>
            ) : (
              "Create"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
