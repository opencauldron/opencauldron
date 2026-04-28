"use client";

/**
 * DeleteBrandModal — shared destructive flow used by both the brands list
 * (⋯ menu) and the brand settings page (Danger Zone). Confirms via a
 * GitHub-style "type the brand name" guard so the destructive button stays
 * disabled until the input matches.
 */

import { useId, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface DeleteBrandTarget {
  id: string;
  name: string;
  slug: string | null;
  assetCount: number;
  brewCount: number;
}

export interface DeleteBrandReassignTarget {
  id: string;
  name: string;
  slug: string | null;
}

interface DeleteBrandModalProps {
  open: boolean;
  brand: DeleteBrandTarget;
  availableTargets: DeleteBrandReassignTarget[];
  onClose: () => void;
  onDeleted?: () => void;
}

type AssetAction = "reassign" | "delete";

export function DeleteBrandModal(props: DeleteBrandModalProps) {
  // Re-mount the form on every open so initial state derives cleanly from the
  // current props — no useEffect-driven reset, which the linter rightly hates.
  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
    >
      {props.open && <DeleteBrandModalForm {...props} />}
    </Dialog>
  );
}

function DeleteBrandModalForm({
  brand,
  availableTargets,
  onClose,
  onDeleted,
}: DeleteBrandModalProps) {
  const reassignRadioId = useId();
  const deleteRadioId = useId();
  const targetSelectId = useId();
  const confirmInputId = useId();

  // Default to reassign when there's a target available, else delete-with.
  const [action, setAction] = useState<AssetAction>(
    availableTargets.length > 0 ? "reassign" : "delete"
  );
  const [reassignBrandId, setReassignBrandId] = useState<string>(
    availableTargets[0]?.id ?? ""
  );
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const confirmMatches = confirmText === brand.name;
  const reassignReady =
    action === "delete" || (!!reassignBrandId && reassignBrandId.length > 0);
  const canSubmit = confirmMatches && reassignReady && !submitting;

  const inventoryLine = useMemo(() => {
    const a = brand.assetCount;
    const b = brand.brewCount;
    const aTxt = `${a} ${a === 1 ? "asset" : "assets"}`;
    const bTxt = `${b} ${b === 1 ? "brew" : "brews"}`;
    return `This brand has ${aTxt} and ${bTxt}. What should happen to them?`;
  }, [brand.assetCount, brand.brewCount]);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/brands/${brand.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "reassign"
            ? { assetAction: "reassign", reassignBrandId }
            : { assetAction: "delete" }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data?.error as string | undefined) ?? "Failed to delete brand"
        );
      }
      toast.success(`Brand "${brand.name}" deleted`);
      onDeleted?.();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete brand"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Delete {brand.name}?</DialogTitle>
        <DialogDescription>{inventoryLine}</DialogDescription>
      </DialogHeader>

        <div className="space-y-4">
          {/* Asset-action radio group */}
          <div className="space-y-2">
            <label
              className="flex items-start gap-2 rounded-md border p-3 text-sm"
              htmlFor={reassignRadioId}
            >
              <input
                id={reassignRadioId}
                type="radio"
                name="asset-action"
                value="reassign"
                checked={action === "reassign"}
                disabled={availableTargets.length === 0}
                onChange={() => setAction("reassign")}
                className="mt-1"
              />
              <span className="flex-1">
                <span className="block font-medium">
                  Move them to another brand
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {availableTargets.length === 0
                    ? "No other brand is available — create one first."
                    : "Assets and brews are reassigned to the brand below."}
                </span>
              </span>
            </label>
            {action === "reassign" && availableTargets.length > 0 && (
              <div className="ml-7 space-y-1">
                <Label htmlFor={targetSelectId} className="sr-only">
                  Reassign target
                </Label>
                <Select
                  value={reassignBrandId}
                  onValueChange={(v) => setReassignBrandId(v ?? "")}
                >
                  <SelectTrigger id={targetSelectId} className="w-full">
                    <SelectValue placeholder="Pick a brand" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTargets.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <label
              className="flex items-start gap-2 rounded-md border p-3 text-sm"
              htmlFor={deleteRadioId}
            >
              <input
                id={deleteRadioId}
                type="radio"
                name="asset-action"
                value="delete"
                checked={action === "delete"}
                onChange={() => setAction("delete")}
                className="mt-1"
              />
              <span className="flex-1">
                <span className="block font-medium">
                  Delete them along with the brand
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  All {brand.assetCount} {brand.assetCount === 1 ? "asset" : "assets"}{" "}
                  and {brand.brewCount} {brand.brewCount === 1 ? "brew" : "brews"}{" "}
                  are permanently removed. This cannot be undone.
                </span>
              </span>
            </label>
          </div>

          {/* GitHub-style confirmation gate */}
          <div className="space-y-2">
            <Label htmlFor={confirmInputId} className="text-xs">
              Type{" "}
              <span className="font-mono font-semibold text-foreground">
                {brand.name}
              </span>{" "}
              to confirm
            </Label>
            <Input
              id={confirmInputId}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={`Type ${brand.name} to confirm`}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>
          Cancel
        </DialogClose>
        <Button
          variant="destructive"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Delete brand
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
