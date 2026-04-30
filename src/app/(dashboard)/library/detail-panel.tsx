"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  Hash,
  Loader2,
  Pin,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { LibraryAsset } from "./library-client";

export interface LibraryBrand {
  id: string;
  name: string;
  color: string;
  isPersonal: boolean;
  anchorAssetIds: string[];
}

interface LibraryDetailPanelProps {
  asset: LibraryAsset | null;
  brands: LibraryBrand[];
  onClose: () => void;
  onAssetUpdate: (next: LibraryAsset) => void;
  onAssetDelete: (id: string) => void;
  onBrandPinChange: (
    brandId: string,
    assetId: string,
    pinned: boolean
  ) => void;
}

// ---------------------------------------------------------------------------
// Detail panel — slide-out Sheet.
// Composition: header (file-name editor) + scrollable body (preview, metadata,
// tags, campaigns, brand-pin list) + footer (Use as input / Download / Delete).
// Open state is derived from `asset !== null` so consumers don't pass a
// boolean alongside the data — see vercel-composition-patterns.
// ---------------------------------------------------------------------------

export function LibraryDetailPanel({
  asset,
  brands,
  onClose,
  onAssetUpdate,
  onAssetDelete,
  onBrandPinChange,
}: LibraryDetailPanelProps) {
  return (
    <Sheet
      open={asset !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto sm:!max-w-md"
      >
        {asset ? (
          <DetailPanelBody
            asset={asset}
            brands={brands}
            onAssetUpdate={onAssetUpdate}
            onAssetDelete={onAssetDelete}
            onBrandPinChange={onBrandPinChange}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Body — split out so the Sheet doesn't hold stale state on close/reopen.
// `key={asset.id}` on the parent isn't necessary: each open re-mounts the
// body via the conditional render above, which is the same effect.
// ---------------------------------------------------------------------------

function DetailPanelBody({
  asset,
  brands,
  onAssetUpdate,
  onAssetDelete,
  onBrandPinChange,
}: {
  asset: LibraryAsset;
  brands: LibraryBrand[];
  onAssetUpdate: (next: LibraryAsset) => void;
  onAssetDelete: (id: string) => void;
  onBrandPinChange: (
    brandId: string,
    assetId: string,
    pinned: boolean
  ) => void;
}) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleUse = () => {
    const params = new URLSearchParams({ imageInput: asset.url });
    router.push(`/generate?${params.toString()}`);
  };

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = asset.url;
    a.download = asset.fileName ?? `library-${asset.id.slice(0, 8)}.png`;
    a.click();
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/library/${asset.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      toast.success("Asset deleted");
      onAssetDelete(asset.id);
      setConfirmDelete(false);
    } catch {
      toast.error("Couldn't delete asset. Try again.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <SheetHeader className="px-5 pt-5 pb-3">
        <SheetTitle className="truncate pr-8">
          {asset.fileName ?? "Untitled asset"}
        </SheetTitle>
        <SheetDescription>
          {formatRelativeDate(asset.createdAt)} · {humanSource(asset.source)}
        </SheetDescription>
      </SheetHeader>

      <Separator />

      <div className="flex flex-col gap-5 px-5 py-5">
        {/* Preview */}
        <div className="overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset.url}
            alt={asset.fileName ?? "Library asset preview"}
            className="block h-auto max-h-[55vh] w-full object-contain"
            loading="eager"
            decoding="async"
          />
        </div>

        {/* Metadata chips */}
        <MetadataChips asset={asset} />

        <Separator />

        {/* File name */}
        <FileNameField
          key={asset.id}
          assetId={asset.id}
          initialValue={asset.fileName ?? ""}
          onSaved={(fileName) => onAssetUpdate({ ...asset, fileName })}
        />

        {/* Tags */}
        <ChipEditor
          label="Tags"
          placeholder="Add a tag"
          values={asset.tags}
          onChange={async (next) => {
            const ok = await patchAsset(asset.id, { tags: next });
            if (ok) onAssetUpdate({ ...asset, tags: next });
            return ok;
          }}
          emptyHint="Tags help you find this asset later — add a few descriptors."
        />

        {/* Campaigns */}
        <ChipEditor
          label="Campaigns"
          placeholder="Add a campaign"
          values={asset.campaigns}
          onChange={async (next) => {
            const ok = await patchAsset(asset.id, { campaigns: next });
            if (ok) onAssetUpdate({ ...asset, campaigns: next });
            return ok;
          }}
          emptyHint="Group assets by campaign to keep launches organized."
        />

        <Separator />

        {/* Brand-anchor pinning */}
        <BrandPinList
          assetId={asset.id}
          brands={brands}
          onChange={onBrandPinChange}
        />
      </div>

      <SheetFooter className="sticky bottom-0 border-t border-border bg-background/95 px-5 py-4 backdrop-blur supports-backdrop-filter:bg-background/80">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleUse} className="flex-1 min-w-[10rem]">
            <Wand2 aria-hidden />
            Use as input
          </Button>
          <Button variant="outline" onClick={handleDownload} size="icon">
            <Download aria-hidden />
            <span className="sr-only">Download</span>
          </Button>
          <Button
            variant="destructive"
            onClick={() => setConfirmDelete(true)}
            size="icon"
          >
            <Trash2 aria-hidden />
            <span className="sr-only">Delete</span>
          </Button>
        </div>
      </SheetFooter>

      <Dialog
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete asset?</DialogTitle>
            <DialogDescription>
              This permanently removes the asset and its thumbnail from
              storage. Brews and history that referenced it will keep their
              copies.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 aria-hidden />
                  Delete
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Metadata chips
// ---------------------------------------------------------------------------

function MetadataChips({ asset }: { asset: LibraryAsset }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {asset.width && asset.height ? (
        <Badge variant="secondary">
          {asset.width}×{asset.height}
        </Badge>
      ) : null}
      {asset.fileSize ? (
        <Badge variant="secondary">{formatFileSize(asset.fileSize)}</Badge>
      ) : null}
      {asset.usageCount > 0 ? (
        <Badge variant="outline">
          <Hash aria-hidden />
          Used {asset.usageCount} {asset.usageCount === 1 ? "time" : "times"}
        </Badge>
      ) : null}
      {asset.embeddedAt ? (
        <Badge variant="outline" className="gap-1">
          <Sparkles aria-hidden />
          Indexed
        </Badge>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File name editor — saves on blur (matches the spec's "editable for v1" call).
// ---------------------------------------------------------------------------

function FileNameField({
  assetId,
  initialValue,
  onSaved,
}: {
  assetId: string;
  initialValue: string;
  onSaved: (next: string | null) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  // Note: parent passes `key={assetId}` so a different asset re-mounts this
  // component, which means we don't need a sync effect to reset `value`.

  const persist = async () => {
    const trimmed = value.trim();
    if (trimmed === initialValue.trim()) return;
    setSaving(true);
    try {
      const next = trimmed.length > 0 ? trimmed : null;
      const ok = await patchAsset(assetId, { fileName: next });
      if (ok) {
        onSaved(next);
        toast.success("Name updated");
      } else {
        toast.error("Couldn't rename. Try again.");
        setValue(initialValue);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`filename-${assetId}`}>File name</Label>
      <div className="relative">
        <Input
          id={`filename-${assetId}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={persist}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Untitled asset"
          disabled={saving}
        />
        {saving && (
          <Loader2
            className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chip editor — generic over tags + campaigns. Patterns-explicit-variants:
// no boolean `mode="campaign"` prop; both call sites just pass label + onChange.
// ---------------------------------------------------------------------------

function ChipEditor({
  label,
  placeholder,
  values,
  onChange,
  emptyHint,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => Promise<boolean>;
  emptyHint: string;
}) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const commitAdd = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (values.includes(trimmed)) {
      setDraft("");
      return;
    }
    const next = [...values, trimmed];
    setPending(trimmed);
    const ok = await onChange(next);
    setPending(null);
    if (!ok) {
      toast.error(`Couldn't add ${label.toLowerCase().replace(/s$/, "")}.`);
      return;
    }
    setDraft("");
  };

  const handleRemove = async (val: string) => {
    setPending(val);
    const next = values.filter((v) => v !== val);
    const ok = await onChange(next);
    setPending(null);
    if (!ok) {
      toast.error(`Couldn't remove ${label.toLowerCase().replace(/s$/, "")}.`);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => handleRemove(v)}
              disabled={pending === v}
              className={cn(
                "group/chip inline-flex h-6 items-center gap-1 rounded-md bg-muted px-2 text-xs font-medium text-foreground ring-1 ring-foreground/10 transition-colors",
                "hover:bg-destructive/10 hover:text-destructive hover:ring-destructive/30",
                "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                pending === v && "opacity-60"
              )}
              aria-label={`Remove ${label.toLowerCase().replace(/s$/, "")} ${v}`}
            >
              <span>{v}</span>
              {pending === v ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : (
                <X
                  className="size-3 text-muted-foreground transition-colors group-hover/chip:text-destructive"
                  aria-hidden
                />
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitAdd();
            }
            if (e.key === "Backspace" && !draft && values.length > 0) {
              handleRemove(values[values.length - 1]);
            }
          }}
          placeholder={placeholder}
          aria-label={`Add ${label.toLowerCase().replace(/s$/, "")}`}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={commitAdd}
          disabled={!draft.trim() || pending !== null}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brand-anchor pin list
// ---------------------------------------------------------------------------

function BrandPinList({
  assetId,
  brands,
  onChange,
}: {
  assetId: string;
  brands: LibraryBrand[];
  onChange: (brandId: string, assetId: string, pinned: boolean) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  if (brands.length === 0) {
    return null;
  }

  const togglePin = async (brand: LibraryBrand) => {
    const isPinned = brand.anchorAssetIds.includes(assetId);
    setBusy(brand.id);
    try {
      const res = await fetch(`/api/library/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pinnedToBrand: { brandId: brand.id, pinned: !isPinned },
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      onChange(brand.id, assetId, !isPinned);
      toast.success(
        !isPinned
          ? `Pinned to ${brand.name}`
          : `Unpinned from ${brand.name}`
      );
    } catch {
      toast.error("Couldn't update brand pin. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Label>Pin to brand</Label>
      <p className="text-xs text-muted-foreground">
        Pinned assets show up as anchors on a brand&apos;s kit and influence
        future generations.
      </p>
      <ul className="flex flex-col gap-1">
        {brands.map((brand) => {
          const pinned = brand.anchorAssetIds.includes(assetId);
          const isBusy = busy === brand.id;
          return (
            <li key={brand.id}>
              <button
                type="button"
                onClick={() => togglePin(brand)}
                disabled={isBusy}
                aria-pressed={pinned}
                className={cn(
                  "group/brand flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                  "hover:bg-accent",
                  "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  pinned
                    ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                    : "ring-1 ring-transparent",
                  isBusy && "opacity-60"
                )}
              >
                <span
                  aria-hidden
                  className="inline-block size-2.5 rounded-full ring-1 ring-foreground/20"
                  style={{ background: brand.color }}
                />
                <span className="flex-1 truncate">
                  {brand.isPersonal ? `${brand.name} (Personal)` : brand.name}
                </span>
                {isBusy ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : (
                  <Pin
                    className={cn(
                      "size-4 shrink-0 transition-colors",
                      pinned
                        ? "text-primary"
                        : "text-muted-foreground group-hover/brand:text-foreground"
                    )}
                    fill={pinned ? "currentColor" : "none"}
                    aria-hidden
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function patchAsset(
  id: string,
  body: Record<string, unknown>
): Promise<boolean> {
  try {
    const res = await fetch(`/api/library/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function humanSource(source: LibraryAsset["source"]): string {
  switch (source) {
    case "uploaded":
      return "uploaded";
    case "generated":
      return "generated";
    case "imported":
      return "imported";
    default:
      return source;
  }
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
