/**
 * Asset status badge — surfaces the five-state lifecycle (FR-009 / FR-010).
 *
 * The colour vocabulary is consistent across the app: drafts read as neutral,
 * in-review as the brand-accent indigo, approved emerald-green, rejected red,
 * archived dimmed grey. Each state has a Lucide icon so the meaning carries
 * even at small sizes / for users who can't distinguish the colour pair.
 */
import {
  Archive,
  CheckCircle2,
  Eye,
  FileText,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type AssetStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "rejected"
  | "archived";

interface StatusVariant {
  label: string;
  Icon: LucideIcon;
  className: string;
}

const VARIANTS: Record<AssetStatus, StatusVariant> = {
  draft: {
    label: "Draft",
    Icon: FileText,
    className:
      "bg-muted/60 text-foreground/70 border-border ring-1 ring-inset ring-border/40",
  },
  in_review: {
    label: "In review",
    Icon: Eye,
    className:
      "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 ring-1 ring-inset ring-indigo-500/30",
  },
  approved: {
    label: "Approved",
    Icon: CheckCircle2,
    className:
      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/30",
  },
  rejected: {
    label: "Rejected",
    Icon: XCircle,
    className:
      "bg-rose-500/10 text-rose-600 dark:text-rose-300 ring-1 ring-inset ring-rose-500/30",
  },
  archived: {
    label: "Archived",
    Icon: Archive,
    className:
      "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300 ring-1 ring-inset ring-zinc-500/30",
  },
};

export const STATUS_LABELS: Record<AssetStatus, string> = Object.fromEntries(
  (Object.entries(VARIANTS) as [AssetStatus, StatusVariant][]).map(([k, v]) => [
    k,
    v.label,
  ])
) as Record<AssetStatus, string>;

interface StatusBadgeProps {
  status: AssetStatus;
  size?: "sm" | "md";
  className?: string;
}

export function StatusBadge({
  status,
  size = "sm",
  className,
}: StatusBadgeProps) {
  const variant = VARIANTS[status];
  const { Icon, label, className: variantClass } = variant;
  const sizeClass = size === "md" ? "h-6 px-2.5 text-xs" : "h-5 px-2 text-[11px]";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap",
        sizeClass,
        variantClass,
        className
      )}
      data-status={status}
    >
      <Icon className="size-3" />
      {label}
    </span>
  );
}

export const ASSET_STATUSES: AssetStatus[] = [
  "draft",
  "in_review",
  "approved",
  "rejected",
  "archived",
];
