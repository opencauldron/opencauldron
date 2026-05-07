"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Archive,
  ArrowRightLeft,
  CheckCircle2,
  FolderInput,
  Send,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  BulkBrandPicker,
  type BulkBrandOption,
} from "./bulk-brand-picker";
import {
  BulkCampaignPicker,
  type BulkCampaignOption,
} from "./bulk-campaign-picker";
import type { CampaignMode } from "@/lib/assets/mutations";

/**
 * Asset shape the action bar reads to compute eligibility. Both the Library
 * and Gallery clients pass a slim projection from their richer asset types.
 */
export interface BulkBarAsset {
  id: string;
  brandId: string | null;
  status: "draft" | "in_review" | "approved" | "rejected" | "archived" | null;
  userId: string;
}

export type BulkActionKind =
  | "submit"
  | "approve"
  | "reject"
  | "archive"
  | "delete"
  | "moveBrand"
  | "campaigns";

export interface BulkServerResult {
  requested: number;
  succeeded: string[];
  failed: { id: string; code: string; message: string }[];
}

interface BulkActionBarProps {
  /** All currently-selected assets (slim projection). */
  assets: BulkBarAsset[];
  /** Current viewer's permissions per brand (server is source of truth, this
   *  just toggles the buttons). */
  viewer: {
    userId: string | null;
    workspaceRole: "owner" | "admin" | "member" | null;
    brandRoles: Record<string, "brand_manager" | "creator" | "viewer">;
  };
  /** Brands the user can move assets into. Filtered by the picker. */
  brandOptions: BulkBrandOption[];
  /** Campaigns the user can see across all brands. Picker filters per brand. */
  campaignOptions: BulkCampaignOption[];
  /** When set, hide "Move to brand" — the surrounding view is locked to one
   *  brand (Brand Gallery). */
  lockedBrandId?: string;
  onClear: () => void;
  /** Fired after the API responds. Pass the asset ids that succeeded so the
   *  parent can patch its local state. */
  onApplied: (kind: BulkActionKind, succeeded: string[]) => void;
}

interface ConfirmState {
  kind: "reject" | "archive" | "delete";
  count: number;
}

export function BulkActionBar({
  assets,
  viewer,
  brandOptions,
  campaignOptions,
  lockedBrandId,
  onClear,
  onApplied,
}: BulkActionBarProps) {
  const [submitting, setSubmitting] = useState<BulkActionKind | null>(null);
  const [brandPickerOpen, setBrandPickerOpen] = useState(false);
  const [campaignPickerOpen, setCampaignPickerOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const counts = useMemo(() => computeCounts(assets, viewer), [assets, viewer]);

  if (assets.length === 0) return null;

  const selectionBrandIds = Array.from(
    new Set(assets.map((a) => a.brandId).filter((b): b is string => Boolean(b)))
  );
  const singleBrandId =
    selectionBrandIds.length === 1 ? selectionBrandIds[0] : null;

  const fire = async (kind: BulkActionKind, run: () => Promise<BulkServerResult>) => {
    setSubmitting(kind);
    try {
      const result = await run();
      onApplied(kind, result.succeeded);
      summarizeToast(kind, result);
    } catch {
      toast.error("Couldn't complete that action. Try again.");
    } finally {
      setSubmitting(null);
    }
  };

  const handleTransition = (
    action: "submit" | "approve" | "reject" | "archive"
  ) =>
    fire(action, () =>
      callBulk("/api/assets/bulk/transition", "POST", {
        ids: assets.map((a) => a.id),
        action,
      })
    );

  const handleDelete = () =>
    fire("delete", () =>
      callBulk("/api/assets/bulk", "DELETE", {
        ids: assets.map((a) => a.id),
      })
    );

  const handleReassign = (brandId: string) =>
    fire("moveBrand", () =>
      callBulk("/api/assets/bulk/reassign-brand", "POST", {
        ids: assets.map((a) => a.id),
        targetBrandId: brandId,
      })
    );

  const handleCampaigns = (input: {
    campaignIds: string[];
    mode: CampaignMode;
  }) =>
    fire("campaigns", () =>
      callBulk("/api/assets/bulk/campaigns", "PATCH", {
        ids: assets.map((a) => a.id),
        campaignIds: input.campaignIds,
        mode: input.mode,
      })
    );

  return (
    <>
      <div
        role="toolbar"
        aria-label="Bulk actions"
        data-slot="bulk-action-bar"
        className={cn(
          "fixed bottom-4 left-1/2 z-40 -translate-x-1/2",
          "flex max-w-[min(100vw-2rem,720px)] items-center gap-1.5 rounded-2xl bg-card px-2 py-2 ring-1 ring-foreground/10 shadow-lg",
          "animate-in fade-in slide-in-from-bottom-2 duration-150"
        )}
      >
        <div className="flex items-center gap-2 px-2">
          <span
            aria-live="polite"
            className="font-mono text-xs tabular-nums text-muted-foreground"
          >
            {assets.length} selected
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Clear selection"
            onClick={onClear}
            disabled={!!submitting}
          >
            <X />
          </Button>
        </div>

        <span aria-hidden className="h-5 w-px bg-foreground/10" />

        <ActionButton
          icon={<Send />}
          label="Submit"
          tooltip={tooltipFor(counts.canSubmit, assets.length, "submit")}
          disabled={counts.canSubmit === 0 || !!submitting}
          loading={submitting === "submit"}
          onClick={() => handleTransition("submit")}
        />
        <ActionButton
          icon={<CheckCircle2 />}
          label="Approve"
          tooltip={tooltipFor(counts.canApprove, assets.length, "approve")}
          disabled={counts.canApprove === 0 || !!submitting}
          loading={submitting === "approve"}
          onClick={() => handleTransition("approve")}
        />
        <ActionButton
          icon={<XCircle />}
          label="Reject"
          tooltip={tooltipFor(counts.canReject, assets.length, "reject")}
          disabled={counts.canReject === 0 || !!submitting}
          loading={submitting === "reject"}
          onClick={() =>
            setConfirm({ kind: "reject", count: counts.canReject })
          }
        />
        <ActionButton
          icon={<Archive />}
          label="Archive"
          tooltip={tooltipFor(counts.canArchive, assets.length, "archive")}
          disabled={counts.canArchive === 0 || !!submitting}
          loading={submitting === "archive"}
          onClick={() =>
            setConfirm({ kind: "archive", count: counts.canArchive })
          }
        />

        <span aria-hidden className="h-5 w-px bg-foreground/10" />

        {!lockedBrandId && (
          <ActionButton
            icon={<ArrowRightLeft />}
            label="Move"
            tooltip={`Move ${assets.length} to brand`}
            disabled={!!submitting}
            loading={submitting === "moveBrand"}
            onClick={() => setBrandPickerOpen(true)}
          />
        )}
        <ActionButton
          icon={<FolderInput />}
          label="Campaigns"
          tooltip={
            singleBrandId
              ? `Update campaigns on ${assets.length}`
              : "Select assets from one brand to assign campaigns"
          }
          disabled={!!submitting}
          loading={submitting === "campaigns"}
          onClick={() => setCampaignPickerOpen(true)}
        />

        <span aria-hidden className="h-5 w-px bg-foreground/10" />

        <ActionButton
          icon={<Trash2 />}
          label="Delete"
          tooltip={tooltipFor(counts.canDelete, assets.length, "delete")}
          variant="destructive"
          disabled={counts.canDelete === 0 || !!submitting}
          loading={submitting === "delete"}
          onClick={() =>
            setConfirm({ kind: "delete", count: counts.canDelete })
          }
        />
      </div>

      <BulkBrandPicker
        open={brandPickerOpen}
        onOpenChange={setBrandPickerOpen}
        brands={brandOptions}
        excludeBrandIds={selectionBrandIds}
        count={assets.length}
        onConfirm={handleReassign}
      />

      <BulkCampaignPicker
        open={campaignPickerOpen}
        onOpenChange={setCampaignPickerOpen}
        campaigns={campaignOptions}
        selectionBrandId={singleBrandId}
        count={assets.length}
        onConfirm={handleCampaigns}
      />

      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        {confirm && (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{confirmTitle(confirm.kind)}</DialogTitle>
              <DialogDescription>
                {confirmDescription(confirm)}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirm(null)}
                disabled={!!submitting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={!!submitting || confirm.count === 0}
                onClick={async () => {
                  const kind = confirm.kind;
                  setConfirm(null);
                  if (kind === "delete") await handleDelete();
                  else await handleTransition(kind);
                }}
              >
                {confirmCta(confirm.kind)}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Eligibility — pure helpers. The server is the source of truth; this just
// dims buttons that have no chance of succeeding for any selected asset.
// ---------------------------------------------------------------------------

interface EligibilityCounts {
  canSubmit: number;
  canApprove: number;
  canReject: number;
  canArchive: number;
  canDelete: number;
}

function computeCounts(
  assets: BulkBarAsset[],
  viewer: BulkActionBarProps["viewer"]
): EligibilityCounts {
  let canSubmit = 0;
  let canApprove = 0;
  let canReject = 0;
  let canArchive = 0;
  let canDelete = 0;

  const isAdmin =
    viewer.workspaceRole === "owner" || viewer.workspaceRole === "admin";

  for (const a of assets) {
    if (!a.brandId) continue;
    const brandRole = viewer.brandRoles[a.brandId] ?? null;
    const isManager = isAdmin || brandRole === "brand_manager";
    const isCreator = isManager || brandRole === "creator";
    const isOwner = a.userId === viewer.userId;

    if (a.status === "draft" && (isManager || (isCreator && isOwner))) {
      canSubmit += 1;
    }
    if (a.status === "in_review" && isManager) {
      canApprove += 1;
      canReject += 1;
    }
    if (
      isManager &&
      (a.status === "draft" ||
        a.status === "in_review" ||
        a.status === "approved" ||
        a.status === "rejected")
    ) {
      canArchive += 1;
    }
    if (a.status !== "approved" && (isOwner || isManager)) {
      canDelete += 1;
    }
  }

  return { canSubmit, canApprove, canReject, canArchive, canDelete };
}

function tooltipFor(eligible: number, total: number, verb: string): string {
  if (eligible === 0) {
    return `Nothing to ${verb} in this selection`;
  }
  if (eligible === total) {
    return `${verb[0].toUpperCase() + verb.slice(1)} ${total}`;
  }
  return `${eligible} of ${total} selected can be ${pastTense(verb)}`;
}

function pastTense(verb: string): string {
  switch (verb) {
    case "submit":
      return "submitted";
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "archive":
      return "archived";
    case "delete":
      return "deleted";
    default:
      return verb + "ed";
  }
}

function confirmTitle(kind: ConfirmState["kind"]): string {
  switch (kind) {
    case "reject":
      return "Reject selected assets?";
    case "archive":
      return "Archive selected assets?";
    case "delete":
      return "Delete selected assets?";
  }
}

function confirmDescription(confirm: ConfirmState): string {
  if (confirm.count === 0) {
    return "Nothing in your selection is eligible for this action.";
  }
  switch (confirm.kind) {
    case "reject":
      return `${confirm.count} ${confirm.count === 1 ? "asset" : "assets"} will be rejected. The submitter will be notified.`;
    case "archive":
      return `${confirm.count} ${confirm.count === 1 ? "asset" : "assets"} will be archived. You can unarchive later from the asset detail panel.`;
    case "delete":
      return `${confirm.count} ${confirm.count === 1 ? "asset" : "assets"} will be permanently deleted. Approved assets are not deleted; archive them instead.`;
  }
}

function confirmCta(kind: ConfirmState["kind"]): string {
  switch (kind) {
    case "reject":
      return "Reject";
    case "archive":
      return "Archive";
    case "delete":
      return "Delete";
  }
}

function summarizeToast(kind: BulkActionKind, result: BulkServerResult): void {
  const verb = pastTense(actionVerb(kind));
  if (result.failed.length === 0) {
    toast.success(`${result.succeeded.length} ${verb}.`);
    return;
  }
  if (result.succeeded.length === 0) {
    const sample = result.failed[0]?.code ?? "failed";
    toast.error(`Couldn't ${actionVerb(kind)} ${result.failed.length}: ${humanizeCode(sample)}`);
    return;
  }
  const sample = result.failed[0]?.code ?? "failed";
  toast.message(
    `${result.succeeded.length} ${verb}, ${result.failed.length} failed: ${humanizeCode(sample)}`
  );
}

function actionVerb(kind: BulkActionKind): string {
  switch (kind) {
    case "submit":
      return "submit";
    case "approve":
      return "approve";
    case "reject":
      return "reject";
    case "archive":
      return "archive";
    case "delete":
      return "delete";
    case "moveBrand":
      return "move";
    case "campaigns":
      return "update";
  }
}

function humanizeCode(code: string): string {
  switch (code) {
    case "asset_immutable":
    case "approved_immutable_fork_required":
      return "approved assets must be forked";
    case "forbidden":
      return "permission denied";
    case "not_found":
      return "asset not found";
    case "invalid_transition":
      return "not in the right state";
    case "personal_brand_no_review":
      return "personal-brand assets can't enter review";
    case "self_approval_blocked":
      return "self-approval is disabled";
    case "campaigns_not_in_brand":
      return "some campaigns don't belong to that brand";
    case "cross_workspace_move_forbidden":
      return "cross-workspace move blocked";
    default:
      return code.replaceAll("_", " ");
  }
}

async function callBulk(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown
): Promise<BulkServerResult> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`bulk request failed: ${res.status}`);
  }
  return (await res.json()) as BulkServerResult;
}

// ---------------------------------------------------------------------------
// Action button — small icon button with an inline tooltip.
// ---------------------------------------------------------------------------

function ActionButton({
  icon,
  label,
  tooltip,
  disabled,
  loading,
  onClick,
  variant = "ghost",
}: {
  icon: React.ReactNode;
  label: string;
  tooltip: string;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
  variant?: "ghost" | "destructive";
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={variant}
            size="sm"
            disabled={disabled || loading}
            onClick={onClick}
            aria-label={label}
          />
        }
      >
        {icon}
        <span className="hidden sm:inline">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
