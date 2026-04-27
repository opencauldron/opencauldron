"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

interface Brand {
  id: string;
  name: string;
  slug: string | null;
  color: string;
  isPersonal: boolean;
}

interface Props {
  /** Full list pre-fetched and filtered to non-Personal by the parent. */
  initialBrands: Brand[];
  /** Current pathname so we can mark the active row. */
  pathname: string;
}

function sortAndFilter(brands: Brand[]): Brand[] {
  return brands
    .filter((b) => !b.isPersonal)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function BrandList({ initialBrands, pathname }: Props) {
  const [brands, setBrands] = useState<Brand[]>(() => sortAndFilter(initialBrands));

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
        setBrands(sortAndFilter(data));
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

  if (brands.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>BRANDS</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {brands.map((brand) => {
            const href = `/brands/${brand.slug ?? brand.id}`;
            const isActive = brand.slug
              ? pathname.startsWith(`/brands/${brand.slug}`)
              : pathname.startsWith(`/brands/${brand.id}`);

            return (
              <SidebarMenuItem key={brand.id}>
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
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/10"
                    style={{ backgroundColor: brand.color }}
                  />
                  <span>{brand.name}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
