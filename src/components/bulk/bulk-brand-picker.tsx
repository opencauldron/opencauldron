"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";

export interface BulkBrandOption {
  id: string;
  name: string;
  color: string;
  isPersonal?: boolean;
  logoUrl?: string | null;
  ownerImage?: string | null;
}

interface BulkBrandPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brands: BulkBrandOption[];
  /** Brand ids the user already has selected from — those are filtered out
   *  of the destination list (a no-op move would just fail). */
  excludeBrandIds?: string[];
  count: number;
  onConfirm: (brandId: string) => Promise<void>;
}

export function BulkBrandPicker({
  open,
  onOpenChange,
  brands,
  excludeBrandIds = [],
  count,
  onConfirm,
}: BulkBrandPickerProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const exclude = new Set(excludeBrandIds);
  // Personal brands are always invalid as a destination — server rejects too,
  // but hiding them keeps the picker honest.
  const eligible = brands.filter(
    (b) => !b.isPersonal && !exclude.has(b.id)
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next);
        if (!next) setSelected(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move to brand</DialogTitle>
          <DialogDescription>
            Move {count} {count === 1 ? "asset" : "assets"} to another brand.
            Status resets to draft so the destination team can review.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[320px] overflow-y-auto rounded-lg ring-1 ring-foreground/10">
          {eligible.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No eligible destination brands.
            </div>
          ) : (
            <ul className="divide-y divide-foreground/5">
              {eligible.map((brand) => {
                const active = selected === brand.id;
                return (
                  <li key={brand.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(brand.id)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2 text-left text-sm",
                        "hover:bg-muted/40",
                        active && "bg-primary/10 text-primary"
                      )}
                      aria-pressed={active}
                    >
                      <BrandMark brand={brand} size="xs" />
                      <span className="flex-1 truncate">{brand.name}</span>
                      {active ? (
                        <svg
                          aria-hidden
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="size-3.5"
                        >
                          <path d="M3 8l3 3 7-7" />
                        </svg>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            disabled={!selected || submitting}
            onClick={async () => {
              if (!selected) return;
              setSubmitting(true);
              try {
                await onConfirm(selected);
                onOpenChange(false);
              } finally {
                setSubmitting(false);
                setSelected(null);
              }
            }}
          >
            {submitting ? "Moving…" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
