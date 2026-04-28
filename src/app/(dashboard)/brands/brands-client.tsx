"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Pencil, Loader2, MoreHorizontal, Tag } from "lucide-react";
import { toast } from "sonner";
import { BrandMark } from "@/components/brand-mark";
import {
  DeleteBrandModal,
  type DeleteBrandReassignTarget,
  type DeleteBrandTarget,
} from "@/components/delete-brand-modal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Brand {
  id: string;
  name: string;
  slug: string | null;
  color: string;
  createdBy: string | null;
  createdAt: string;
  assetCount: number;
  brewCount?: number;
  isPersonal?: boolean;
  logoUrl?: string | null;
  ownerImage?: string | null;
}

// ---------------------------------------------------------------------------
// Preset colors
// ---------------------------------------------------------------------------

const PRESET_COLORS = [
  { label: "Red", value: "#ef4444" },
  { label: "Orange", value: "#f97316" },
  { label: "Yellow", value: "#eab308" },
  { label: "Green", value: "#22c55e" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Indigo", value: "#6366f1" },
  { label: "Purple", value: "#a855f7" },
  { label: "Pink", value: "#ec4899" },
] as const;

// ---------------------------------------------------------------------------
// Color Picker
// ---------------------------------------------------------------------------

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {PRESET_COLORS.map((color) => (
        <button
          key={color.value}
          type="button"
          title={color.label}
          onClick={() => onChange(color.value)}
          className={`size-8 rounded-full border-2 transition-transform hover:scale-110 ${
            value === color.value
              ? "border-foreground ring-2 ring-ring ring-offset-2 ring-offset-background"
              : "border-transparent"
          }`}
          style={{ backgroundColor: color.value }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Brand Dialog
// ---------------------------------------------------------------------------

function AddBrandDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PRESET_COLORS[5].value); // indigo default
  const [saving, setSaving] = useState(false);

  function reset() {
    setName("");
    setColor(PRESET_COLORS[5].value);
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Brand name is required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), color }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create brand");

      toast.success(`Brand "${data.name}" created`);
      reset();
      setOpen(false);
      onCreated();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create brand"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger
        render={<Button size="sm" />}
      >
        <Plus className="mr-1.5 h-4 w-4" />
        Add Brand
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Brand</DialogTitle>
          <DialogDescription>
            Create a brand tag to organize your generated assets.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="brand-name">Name</Label>
            <Input
              id="brand-name"
              placeholder="e.g. Acme Corp"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>Color</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button onClick={handleCreate} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit Brand Dialog
// ---------------------------------------------------------------------------

function EditBrandDialog({
  brand,
  onUpdated,
}: {
  brand: Brand;
  onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(brand.name);
  const [color, setColor] = useState(brand.color);
  const [saving, setSaving] = useState(false);

  function reset() {
    setName(brand.name);
    setColor(brand.color);
  }

  async function handleUpdate() {
    if (!name.trim()) {
      toast.error("Brand name is required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/brands/${brand.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), color }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update brand");

      toast.success(`Brand "${data.name}" updated`);
      setOpen(false);
      onUpdated();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update brand"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger
        render={<Button variant="ghost" size="icon-sm" />}
      >
        <Pencil className="h-3.5 w-3.5" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Brand</DialogTitle>
          <DialogDescription>
            Update the brand name or color.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`edit-name-${brand.id}`}>Name</Label>
            <Input
              id={`edit-name-${brand.id}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleUpdate();
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>Color</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button onClick={handleUpdate} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Brand Card
// ---------------------------------------------------------------------------

function BrandCard({
  brand,
  reassignTargets,
  onRefresh,
}: {
  brand: Brand;
  reassignTargets: DeleteBrandReassignTarget[];
  onRefresh: () => void;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);

  const deleteTarget: DeleteBrandTarget = {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    assetCount: brand.assetCount,
    brewCount: brand.brewCount ?? 0,
  };

  return (
    <div className="group flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/30">
      <div className="flex items-center gap-3 min-w-0">
        <BrandMark
          brand={{
            name: brand.name,
            color: brand.color,
            isPersonal: brand.isPersonal,
            logoUrl: brand.logoUrl,
          }}
          size="md"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{brand.name}</p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {brand.assetCount} {brand.assetCount === 1 ? "asset" : "assets"}
        </Badge>
      </div>
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <EditBrandDialog brand={brand} onUpdated={onRefresh} />
        {/* Personal brands are uneditable from this surface — no delete affordance. */}
        {!brand.isPersonal && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" />}
              aria-label={`More actions for ${brand.name}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                Delete brand
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {!brand.isPersonal && (
        <DeleteBrandModal
          open={deleteOpen}
          brand={deleteTarget}
          availableTargets={reassignTargets}
          onClose={() => setDeleteOpen(false)}
          onDeleted={onRefresh}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Client Component
// ---------------------------------------------------------------------------

export function BrandsClient() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBrands = useCallback(async () => {
    try {
      const res = await fetch("/api/brands");
      if (!res.ok) throw new Error("Failed to load brands");
      const data = await res.json();
      setBrands(data);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load brands"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBrands();
  }, [fetchBrands]);

  // Reassign targets: every non-personal brand visible to the user. The modal
  // narrows further per-row by removing the brand being deleted from its own
  // list of options.
  const reassignPool = useMemo<DeleteBrandReassignTarget[]>(
    () =>
      brands
        .filter((b) => !b.isPersonal)
        .map((b) => ({ id: b.id, name: b.name, slug: b.slug })),
    [brands]
  );

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <AddBrandDialog onCreated={fetchBrands} />
      </div>

      {brands.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Tag className="h-5 w-5 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-sm font-medium">No brands yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first brand to start organizing assets.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {brands.map((brand) => (
            <BrandCard
              key={brand.id}
              brand={brand}
              reassignTargets={reassignPool.filter((t) => t.id !== brand.id)}
              onRefresh={fetchBrands}
            />
          ))}
        </div>
      )}
    </div>
  );
}
