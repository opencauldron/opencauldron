"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Hash,
  Loader2,
  Megaphone,
  MessageSquareText,
  Pin,
  Plus,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AssetDownloadButton } from "@/components/library/asset-download-button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { LibraryAsset, LibraryViewer } from "./library-client";
import { ThreadPanel } from "@/components/threads/thread-panel";

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
  /**
   * Current viewer — sourced from the server-side session in `page.tsx`.
   * Threaded down so the Thread tab can render the composer without
   * re-resolving the session client-side.
   */
  viewer: LibraryViewer;
  /**
   * If a `?message=<id>` is in the URL (deep link from a notification), the
   * panel opens with the Thread tab focused + the row highlighted.
   */
  initialMessageId?: string | null;
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
  viewer,
  initialMessageId,
}: LibraryDetailPanelProps) {
  // Sheet itself doesn't scroll — the Thread tab owns its own scroll region
  // and the composer needs to pin to the bottom. The Info tab scrolls inside
  // its own TabsContent.
  return (
    <Sheet
      open={asset !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden sm:!max-w-md"
      >
        {asset ? (
          <DetailPanelBody
            asset={asset}
            brands={brands}
            onAssetUpdate={onAssetUpdate}
            onAssetDelete={onAssetDelete}
            onBrandPinChange={onBrandPinChange}
            viewer={viewer}
            initialMessageId={initialMessageId ?? null}
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
  viewer,
  initialMessageId,
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
  viewer: LibraryViewer;
  initialMessageId: string | null;
}) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // When deep-linked via `?message=<id>` the panel opens with the Thread tab
  // selected; otherwise default to Info for parity with current behavior.
  const [activeTab, setActiveTab] = useState<string>(
    initialMessageId ? "thread" : "info"
  );

  const handleUse = () => {
    const params = new URLSearchParams({ imageInput: asset.url });
    router.push(`/generate?${params.toString()}`);
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

  const infoBody = (
    <>
      <div className="flex flex-col gap-5 px-5 py-5">
        {/* Preview — prefer the smaller WebP rendition when the encoder has
            produced one (FR-008 / spec US2). Falls back to the original URL
            silently for pending/failed/null statuses; the user is never told
            they're seeing the heavier file. */}
        <div className="overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={
              asset.webpStatus === "ready" && asset.webpUrl
                ? asset.webpUrl
                : asset.url
            }
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

        {/* Campaigns — typeahead Combobox sourced from
            /api/campaigns?brandId=<asset.brandId>. Personal-brand assets
            (brandId === null) skip the picker entirely; they don't support
            campaigns. */}
        <CampaignPicker
          asset={asset}
          onChange={(next) => onAssetUpdate({ ...asset, campaigns: next })}
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
          {/* Dual-format download — split button on desktop with WebP +
              Original choices, single trigger on mobile. Per spec US3 the
              shared component handles all three render modes (ready /
              pending / failed-or-video) and PostHog telemetry. */}
          <AssetDownloadButton
            asset={{
              id: asset.id,
              webpUrl: asset.webpUrl,
              webpFileSize: asset.webpFileSize,
              webpStatus: asset.webpStatus,
              originalFileSize: asset.originalFileSize ?? asset.fileSize ?? 0,
              originalMimeType: asset.originalMimeType,
              kind: asset.mediaType,
            }}
            source="library"
            variant="outline"
          />
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
    </>
  );

  const deleteDialog = (
    <DeleteAssetDialog
      open={confirmDelete}
      deleting={deleting}
      onOpenChange={(open) => setConfirmDelete(open)}
      onConfirm={handleDelete}
    />
  );

  // Tabs strip wraps the content. Info tab is scroll-its-own region (so the
  // page doesn't have two scrollbars). Thread tab fills the remaining height
  // with `flex-1 min-h-0` so the composer stays pinned.
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

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (typeof value === "string") setActiveTab(value);
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-b border-border bg-background px-5 py-2">
          <TabsList variant="line" className="w-full justify-start gap-3">
            <TabsTrigger value="info">Info</TabsTrigger>
            <TabsTrigger value="thread">
              <MessageSquareText aria-hidden />
              Thread
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="info"
          className="flex-1 overflow-y-auto data-active:flex data-active:flex-col"
        >
          {infoBody}
        </TabsContent>

        <TabsContent
          value="thread"
          className="flex min-h-0 flex-1 flex-col data-[hidden]:hidden"
        >
          <ThreadPanel
            // Re-mount on asset change so the stream resets cleanly.
            key={asset.id}
            assetId={asset.id}
            viewer={viewer}
            highlightMessageId={initialMessageId}
          />
        </TabsContent>
      </Tabs>

      {deleteDialog}
    </>
  );
}

// ---------------------------------------------------------------------------
// Delete-confirmation dialog (extracted so the threads-enabled + threads-
// disabled branches can both render it without duplicating ~30 lines of JSX).
// ---------------------------------------------------------------------------

function DeleteAssetDialog({
  open,
  deleting,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  deleting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete asset?</DialogTitle>
          <DialogDescription>
            This permanently removes the asset and its thumbnail from storage.
            Brews and history that referenced it will keep their copies.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
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

// ---------------------------------------------------------------------------
// CampaignPicker — typeahead Combobox over the asset's brand-scoped campaign
// list. Selected values are uuids; chip labels are names. Includes an inline
// "+ New campaign" affordance that opens a small create dialog scoped to the
// asset's brand. Read /api/campaigns?brandId=<asset.brandId>; PATCH
// /api/library/<id> with `{ campaigns: uuid[] }` (full replace).
// ---------------------------------------------------------------------------

interface CampaignOption {
  id: string;
  name: string;
}

function CampaignPicker({
  asset,
  onChange,
}: {
  asset: LibraryAsset;
  onChange: (next: { id: string; name: string }[]) => void;
}) {
  const [options, setOptions] = useState<CampaignOption[] | null>(null);
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const brandId = asset.brandId;

  // Lazy-load campaigns when the popover opens for the first time. Re-fetch
  // when the asset's brand changes (e.g. user reassigned the brand elsewhere
  // and reopens the panel).
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

  const handleToggle = async (option: CampaignOption) => {
    const exists = asset.campaigns.some((c) => c.id === option.id);
    const next = exists
      ? asset.campaigns.filter((c) => c.id !== option.id)
      : [...asset.campaigns, { id: option.id, name: option.name }];
    setPendingId(option.id);
    const ok = await patchAsset(asset.id, {
      campaigns: next.map((c) => c.id),
    });
    setPendingId(null);
    if (!ok) {
      toast.error("Couldn't update campaigns. Try again.");
      return;
    }
    onChange(next);
  };

  const handleRemoveChip = async (campaignId: string) => {
    const next = asset.campaigns.filter((c) => c.id !== campaignId);
    setPendingId(campaignId);
    const ok = await patchAsset(asset.id, {
      campaigns: next.map((c) => c.id),
    });
    setPendingId(null);
    if (!ok) {
      toast.error("Couldn't remove campaign. Try again.");
      return;
    }
    onChange(next);
  };

  const handleCreated = (campaign: CampaignOption) => {
    setOptions((prev) => (prev ? [...prev, campaign] : [campaign]));
    // Auto-attach the new campaign to this asset.
    const next = [...asset.campaigns, { id: campaign.id, name: campaign.name }];
    setPendingId(campaign.id);
    patchAsset(asset.id, { campaigns: next.map((c) => c.id) }).then((ok) => {
      setPendingId(null);
      if (ok) onChange(next);
    });
  };

  // Personal-brand assets (or anything without a brand) can't have campaigns.
  // Render a quiet hint instead of a broken picker.
  if (!brandId) {
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

  const trimmed = search.trim().toLowerCase();
  const filtered = (options ?? []).filter((c) =>
    trimmed.length === 0 ? true : c.name.toLowerCase().includes(trimmed)
  );

  return (
    <div className="flex flex-col gap-2">
      <Label>Campaigns</Label>

      {asset.campaigns.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {asset.campaigns.map((c) => (
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
                {trimmed
                  ? "No matches."
                  : "No campaigns yet on this brand."}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {filtered.map((c) => {
                  const checked = asset.campaigns.some((x) => x.id === c.id);
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

// ---------------------------------------------------------------------------
// CreateCampaignDialog — minimal name + description form. Mirrors the brand
// campaigns admin (`brands/[slug]/campaigns/campaigns-client.tsx`) but inline
// so the user doesn't have to leave the asset detail. Brand-scoped via the
// `brandId` prop so the create POST is always anchored to the asset's brand.
// ---------------------------------------------------------------------------

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

  // Reset on close — render-time pattern, no effect.
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
