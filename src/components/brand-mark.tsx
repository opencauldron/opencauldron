import { User } from "lucide-react";
import { cn } from "@/lib/utils";

export type BrandMarkSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_MAP: Record<BrandMarkSize, string> = {
  xs: "h-4 w-4",
  sm: "h-5 w-5",
  md: "h-6 w-6",
  lg: "h-8 w-8",
  xl: "h-12 w-12",
};

const ICON_SIZE_MAP: Record<BrandMarkSize, string> = {
  xs: "h-2.5 w-2.5",
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5",
  lg: "h-4 w-4",
  xl: "h-6 w-6",
};

export interface BrandMarkBrand {
  name: string;
  color: string;
  isPersonal?: boolean | null;
  logoUrl?: string | null;
}

interface BrandMarkProps {
  brand: BrandMarkBrand;
  size?: BrandMarkSize;
  className?: string;
}

/**
 * Renders a brand's identity mark. Priority:
 *   1. uploaded brand logo  →  the image
 *   2. personal brand (no logo)  →  generic person icon on a muted disc
 *   3. otherwise  →  colored dot
 *
 * Always circular. Sized via a tailwind preset; pass `className` for one-off
 * overrides (e.g. ring color, ml-1).
 */
export function BrandMark({ brand, size = "sm", className }: BrandMarkProps) {
  const sizeClass = SIZE_MAP[size];
  const ringClass = "ring-1 ring-inset ring-black/10 dark:ring-white/10";

  if (brand.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={brand.logoUrl}
        alt=""
        aria-hidden="true"
        className={cn(
          "shrink-0 rounded-full object-cover",
          sizeClass,
          ringClass,
          className
        )}
      />
    );
  }

  if (brand.isPersonal) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
          sizeClass,
          ringClass,
          className
        )}
      >
        <User className={ICON_SIZE_MAP[size]} strokeWidth={2.25} />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn("inline-block shrink-0 rounded-full", sizeClass, ringClass, className)}
      style={{ backgroundColor: brand.color }}
    />
  );
}
