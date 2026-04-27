"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Lock, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

const STORAGE_KEY = "agency-mvp:last-brand-id";

export interface BrandOption {
  id: string;
  name: string;
  color: string;
  slug: string | null;
  isPersonal: boolean;
  ownerId: string | null;
  videoEnabled: boolean;
}

interface Props {
  brands: BrandOption[];
  value: string | null;
  onChange: (brandId: string) => void;
  disabled?: boolean;
  /**
   * If `true`, disabled brands (e.g. without create permission) render with
   * a lock icon. Defaults to `false` since the API layer already excludes
   * brands the user can't read.
   */
  showLockedAffordance?: boolean;
}

/**
 * Brand selector for the generate flow (T074). Lists every brand the
 * current user has any role on; pins Personal to the top; persists the
 * last-used brand in localStorage so refreshes keep context.
 */
export function BrandSelector({
  brands,
  value,
  onChange,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);

  // Sort: Personal first, then alphabetical.
  const sorted = useMemo(() => {
    return [...brands].sort((a, b) => {
      if (a.isPersonal && !b.isPersonal) return -1;
      if (!a.isPersonal && b.isPersonal) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [brands]);

  useEffect(() => {
    if (value || sorted.length === 0) return;
    // Hydrate from localStorage; fall back to Personal-or-first.
    let next: string | null = null;
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && sorted.some((b) => b.id === stored)) next = stored;
    }
    if (!next) {
      const personal = sorted.find((b) => b.isPersonal);
      next = personal?.id ?? sorted[0]?.id ?? null;
    }
    if (next) onChange(next);
  }, [sorted, value, onChange]);

  const selected = sorted.find((b) => b.id === value) ?? null;

  function pick(id: string) {
    onChange(id);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
    setOpen(false);
  }

  const personalGroup = sorted.filter((b) => b.isPersonal);
  const brandGroup = sorted.filter((b) => !b.isPersonal);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="h-9 w-full justify-between gap-2 font-normal"
          >
            {selected ? (
              <span className="flex items-center gap-2 truncate">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: selected.color }}
                  aria-hidden
                />
                <span className="truncate">{selected.name}</span>
                {selected.isPersonal && (
                  <span className="ml-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    personal
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">Select a brand…</span>
            )}
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        }
      />

      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search brands…" />
          <CommandList>
            <CommandEmpty>No brand found.</CommandEmpty>

            {personalGroup.length > 0 && (
              <CommandGroup heading="Personal">
                {personalGroup.map((b) => (
                  <Row key={b.id} brand={b} active={b.id === value} onPick={pick} icon={<User className="size-3.5" />} />
                ))}
              </CommandGroup>
            )}

            {brandGroup.length > 0 && (
              <>
                {personalGroup.length > 0 && <CommandSeparator />}
                <CommandGroup heading="Brands">
                  {brandGroup.map((b) => (
                    <Row key={b.id} brand={b} active={b.id === value} onPick={pick} />
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Row({
  brand,
  active,
  onPick,
  icon,
}: {
  brand: BrandOption;
  active: boolean;
  onPick: (id: string) => void;
  icon?: React.ReactNode;
}) {
  return (
    <CommandItem value={brand.name} onSelect={() => onPick(brand.id)}>
      <span
        className="mr-2 size-2.5 rounded-full"
        style={{ backgroundColor: brand.color }}
        aria-hidden
      />
      <span className="flex-1 truncate">{brand.name}</span>
      {icon}
      {!brand.videoEnabled && !brand.isPersonal && (
        <Lock className="ml-2 size-3 text-muted-foreground" aria-label="Video disabled" />
      )}
      <Check className={cn("ml-2 size-4", active ? "opacity-100" : "opacity-0")} />
    </CommandItem>
  );
}
