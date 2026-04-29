/**
 * Compact relative-time formatter used by the notifications list.
 *
 * Returns short forms like `5m`, `2h`, `Yesterday`, `Apr 12` to keep rows
 * visually quiet — the timestamp is secondary metadata and shouldn't compete
 * with the row's actor + verb.
 *
 * Boundaries:
 *  - <1m         → "now"
 *  - <60m        → "Nm"   (1m, 59m)
 *  - <24h        → "Nh"   (1h, 23h)
 *  - same calendar day - 1 → "Yesterday"
 *  - <7d         → "Nd"
 *  - same year   → "MMM d"  (e.g. "Apr 12")
 *  - older       → "MMM d, YYYY"
 */
export function formatRelativeTime(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);

  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHr < 24) return `${diffHr}h`;

  // Day-aware: distinguish "yesterday" (calendar day) from "24-48h ago".
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86_400_000
  );

  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return `${dayDiff}d`;

  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
