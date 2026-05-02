import { Activity } from "lucide-react";

export type ActivityEmptyVariant = "for-you" | "my-brands" | "workspace";

const COPY: Record<ActivityEmptyVariant, { title: string; body: string }> = {
  "for-you": {
    title: "Nothing's brewing yet",
    body: "Generate, upload, or fork an asset to fill your feed. Your teammates' workspace milestones will appear here too.",
  },
  "my-brands": {
    title: "No brand activity yet",
    body: "Brand-scoped events — submissions, approvals, rejections — for the brands you're a member of will land here.",
  },
  workspace: {
    title: "Quiet workspace",
    body: "Workspace-wide milestones like feats earned and level-ups will appear here as your team makes progress.",
  },
};

interface ActivityEmptyProps {
  variant: ActivityEmptyVariant;
}

/**
 * Friendly empty state per US1 acceptance criterion 4. Voice follows the
 * design rules in `progress.md` Setup notes — short, encouraging, one
 * project verb max ("brewing"), sentence case. No CTA button: each tab's
 * feed is downstream of work the user does elsewhere; pointing them at a
 * single action would be misleading.
 */
export function ActivityEmpty({ variant }: ActivityEmptyProps) {
  const copy = COPY[variant];
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div
        aria-hidden
        className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Activity className="size-5" strokeWidth={1.75} />
      </div>
      <div className="max-w-sm space-y-1">
        <h2 className="text-base font-medium text-foreground">{copy.title}</h2>
        <p className="text-sm text-muted-foreground">{copy.body}</p>
      </div>
    </div>
  );
}
