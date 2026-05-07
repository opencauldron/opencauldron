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
import { cn } from "@/lib/utils";
import type { CampaignMode } from "@/lib/assets/mutations";

export interface BulkCampaignOption {
  id: string;
  name: string;
  brandId: string;
}

interface BulkCampaignPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All campaigns the user can see. Filtered down to the brand of the
   *  current selection at render time. */
  campaigns: BulkCampaignOption[];
  /**
   * The brand of the entire selection. `null` means the selection spans
   * multiple brands (or has no brand) and the picker shows a guard message
   * instead — campaigns are brand-scoped in schema and a cross-brand assign
   * would just fail at the API.
   */
  selectionBrandId: string | null;
  count: number;
  onConfirm: (input: {
    campaignIds: string[];
    mode: CampaignMode;
  }) => Promise<void>;
}

export function BulkCampaignPicker({
  open,
  onOpenChange,
  campaigns,
  selectionBrandId,
  count,
  onConfirm,
}: BulkCampaignPickerProps) {
  const [mode, setMode] = useState<CampaignMode>("add");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (submitting) return;
    if (!next) {
      // Reset state on close so a previous mode/selection doesn't leak
      // between opens — done eagerly on close (not in an effect) to avoid
      // cascading-render lint warnings.
      setSelected(new Set());
      setMode("add");
    }
    onOpenChange(next);
  };

  const eligibleCampaigns = selectionBrandId
    ? campaigns.filter((c) => c.brandId === selectionBrandId)
    : [];

  const canConfirm =
    !!selectionBrandId &&
    !submitting &&
    (mode === "set"
      ? true // set with empty list = clear all campaigns; valid action.
      : selected.size > 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign campaigns</DialogTitle>
          <DialogDescription>
            Update campaigns on {count} {count === 1 ? "asset" : "assets"}.
          </DialogDescription>
        </DialogHeader>

        {!selectionBrandId ? (
          <div className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">
            Select assets from one brand to assign campaigns. Campaigns are
            brand-scoped, so cross-brand selections aren&apos;t supported.
          </div>
        ) : (
          <>
            <div
              role="radiogroup"
              aria-label="Mode"
              className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-sm"
            >
              {(
                [
                  { value: "add", label: "Add" },
                  { value: "remove", label: "Remove" },
                  { value: "set", label: "Replace" },
                ] as { value: CampaignMode; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === opt.value}
                  onClick={() => setMode(opt.value)}
                  className={cn(
                    "rounded-md px-2 py-1.5 font-medium",
                    mode === opt.value
                      ? "bg-background text-foreground ring-1 ring-foreground/10"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="max-h-[280px] overflow-y-auto rounded-lg ring-1 ring-foreground/10">
              {eligibleCampaigns.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No campaigns in this brand yet.
                </div>
              ) : (
                <ul className="divide-y divide-foreground/5">
                  {eligibleCampaigns.map((campaign) => {
                    const active = selected.has(campaign.id);
                    return (
                      <li key={campaign.id}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={active}
                          onClick={() => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(campaign.id)) {
                                next.delete(campaign.id);
                              } else {
                                next.add(campaign.id);
                              }
                              return next;
                            });
                          }}
                          className={cn(
                            "flex w-full items-center gap-3 px-3 py-2 text-left text-sm",
                            "hover:bg-muted/40",
                            active && "bg-primary/10 text-primary"
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "flex size-4 items-center justify-center rounded-sm border",
                              active
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-foreground/25"
                            )}
                          >
                            {active && (
                              <svg
                                viewBox="0 0 16 16"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2.5}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="size-3"
                              >
                                <path d="M3 8l3 3 7-7" />
                              </svg>
                            )}
                          </span>
                          <span className="flex-1 truncate">
                            {campaign.name}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            disabled={!canConfirm}
            onClick={async () => {
              setSubmitting(true);
              try {
                await onConfirm({
                  campaignIds: Array.from(selected),
                  mode,
                });
                handleOpenChange(false);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "Saving…" : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
