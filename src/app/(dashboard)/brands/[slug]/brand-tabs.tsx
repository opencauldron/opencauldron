"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface BrandTabsProps {
  slug: string;
  /** Hidden for non-managers and on Personal brands (FR-006b). */
  showReview: boolean;
}

const TABS = [
  { name: "Gallery", segment: "gallery" },
  { name: "Brews", segment: "brews" },
  { name: "Campaigns", segment: "campaigns" },
  { name: "Kit", segment: "kit" },
  { name: "Members", segment: "members" },
] as const;

export function BrandTabs({ slug, showReview }: BrandTabsProps) {
  const pathname = usePathname();
  const base = `/brands/${slug}`;

  const fullTabs = [
    ...TABS.map((t) => ({ ...t, href: `${base}/${t.segment}` })),
    ...(showReview
      ? [{ name: "Review", segment: "review", href: `${base}/review` }]
      : []),
  ];

  return (
    <nav
      role="tablist"
      aria-label="Brand sections"
      className="-mb-px flex gap-1 border-b border-border/60"
    >
      {fullTabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.segment}
            href={tab.href}
            role="tab"
            aria-selected={active}
            className={cn(
              "relative -mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-primary text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.name}
          </Link>
        );
      })}
    </nav>
  );
}
