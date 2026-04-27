"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { BrandMark } from "@/components/brand-mark";

interface Brand {
  id: string;
  name: string;
  slug: string | null;
  color: string;
  isPersonal: boolean;
  logoUrl?: string | null;
}

interface Props {
  /** Full list pre-fetched by the parent. May include the Personal brand,
   *  which we pin to the top with a generic person icon to distinguish it
   *  from real brand rows. */
  initialBrands: Brand[];
  /** Current pathname so we can mark the active row. */
  pathname: string;
  /** Slot rendered after the brand rows (e.g. "+ Add brand" trigger). */
  trailing?: React.ReactNode;
}

function partition(brands: Brand[]): { real: Brand[]; personal: Brand | null } {
  const real = brands
    .filter((b) => !b.isPersonal)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const personal = brands.find((b) => b.isPersonal) ?? null;
  return { real, personal };
}

export function BrandList({ initialBrands, pathname, trailing }: Props) {
  const [brands, setBrands] = useState<Brand[]>(initialBrands);

  useEffect(() => {
    let cancelled = false;

    const refetch = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      try {
        const res = await fetch("/api/brands");
        if (!res.ok) return;
        const data: Brand[] = await res.json();
        if (cancelled) return;
        setBrands(data);
      } catch {
        // network error — keep the existing list
      }
    };

    window.addEventListener("focus", refetch);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refetch);
    };
  }, []);

  const { real, personal } = partition(brands);

  // Empty state: no brands at all and no trailing slot — collapse the
  // section. The parent uses `canCreateBrand` to gate the "+ Add brand"
  // affordance, so this branch only fires when there's truly nothing to
  // show in the section.
  if (real.length === 0 && !personal && !trailing) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>BRANDS</SidebarGroupLabel>
      <SidebarGroupAction
        render={<Link href="/brands" aria-label="Manage brands" title="Manage brands" />}
      >
        <Settings2 />
      </SidebarGroupAction>
      <SidebarGroupContent>
        <SidebarMenu>
          {personal && (
            <BrandRow
              key={personal.id}
              brand={personal}
              pathname={pathname}
              variant="personal"
            />
          )}
          {real.map((brand) => (
            <BrandRow key={brand.id} brand={brand} pathname={pathname} />
          ))}
          {trailing}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function BrandRow({
  brand,
  pathname,
  variant = "default",
}: {
  brand: Brand;
  pathname: string;
  variant?: "default" | "personal";
}) {
  const href = `/brands/${brand.slug ?? brand.id}`;
  const isActive = brand.slug
    ? pathname.startsWith(`/brands/${brand.slug}`)
    : pathname.startsWith(`/brands/${brand.id}`);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={href} />}
        isActive={isActive}
        tooltip={brand.name}
        className={`group/brand transition-all duration-200 hover:translate-x-0.5 ${
          isActive
            ? "border-l-2 border-primary bg-primary/10 text-primary font-medium"
            : "border-l-2 border-transparent"
        }`}
      >
        <BrandMark
          brand={{
            name: brand.name,
            color: brand.color,
            isPersonal: variant === "personal" || brand.isPersonal,
            logoUrl: brand.logoUrl,
          }}
          size="sm"
        />
        <span>{brand.name}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
