"use client";

/**
 * FilterBar — sticky toolbar above the Library grid with primary facets
 * (Brand, Campaign, Tag) visible by default and Source/Status hidden behind
 * a "More" hatch. Mobile collapses to [Search] [Filters · N] with a bottom
 * sheet for staged filter editing.
 *
 * Composition (compound components — no boolean prop sprawl):
 *
 *   <FilterBar>
 *     <FilterBar.Search>
 *       <SearchInput.Field />
 *       <SearchInput.ModeToggle />        // null in Phase 4
 *     </FilterBar.Search>
 *     <FilterBar.Facets>
 *       <BrandFacet brands={brands} />
 *       <CampaignFacet campaigns={campaigns} />
 *       <TagFacet tags={tags} />
 *       <FilterBar.More>
 *         <SourceFacet />
 *         <StatusFacet visible={hasMixedStatuses} />
 *       </FilterBar.More>
 *     </FilterBar.Facets>
 *     <FilterBar.Summary />
 *     <FilterBar.MobileSheet ... />
 *   </FilterBar>
 *
 * Every facet reads/writes via useLibraryQuery — no prop drilling.
 */

import { useState } from "react";
import {
  Building2,
  Megaphone,
  Tag as TagIcon,
  SlidersHorizontal,
  Sparkles,
  Upload,
  ImageDown,
  CheckCircle2,
  Hourglass,
  XCircle,
  Archive,
  FileText,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
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
} from "@/components/ui/command";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  type AssetSource,
  type AssetStatus,
  type LibraryQuery,
  type TagOp,
  EMPTY_LIBRARY_QUERY,
  countActive,
  serializeLibraryQuery,
  useLibraryQuery,
} from "./use-library-query";

// ---------------------------------------------------------------------------
// Public option types — the page server-hydrates these so popovers don't
// round-trip on first open.
// ---------------------------------------------------------------------------

export interface BrandOption {
  id: string;
  /** Display label. For personal brands the page server resolves this to the
   *  owner's display name (falling back to their email local-part) so admins
   *  can tell multiple "Personal" brands apart. */
  name: string;
  /** True when this is a per-user personal brand. Drives avatar rendering
   *  and the pinned-to-top sort. */
  isPersonal?: boolean;
  /** Owner avatar URL — only set for personal brands. */
  ownerImage?: string | null;
}

export interface CampaignOption {
  id: string;
  name: string;
  brandId: string;
}

export interface TagOption {
  /** Stable identifier for the URL — equals the tag string today. */
  id: string;
  /** Display label. */
  label: string;
}

// ---------------------------------------------------------------------------
// Root + slots
// ---------------------------------------------------------------------------

interface FilterBarProps {
  children: React.ReactNode;
  className?: string;
}

export function FilterBar({ children, className }: FilterBarProps) {
  return (
    <div
      data-slot="library-filter-bar"
      className={cn(
        // Sticky chrome surface — backdrop blur once stuck. Non-card → rounded-none.
        "sticky top-0 z-30 -mx-6 border-b border-border bg-background/85 px-6 py-3 backdrop-blur",
        // The page sets `space-y-6` on its container; counter that for the bar
        // by pulling it tight against the header.
        "supports-backdrop-filter:bg-background/70",
        className
      )}
    >
      {children}
    </div>
  );
}

function Search({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-slot="library-filter-search"
      className="flex min-w-0 flex-1 items-center"
    >
      {children}
    </div>
  );
}

function Facets({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-slot="library-filter-facets"
      className="hidden items-center gap-1.5 md:flex"
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trigger button shared across every facet. Active state changes both color
// AND label so we don't rely on color alone (WCAG 1.4.1).
// ---------------------------------------------------------------------------

interface FacetTriggerProps extends React.ComponentProps<typeof Button> {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  ariaLabel?: string;
}

function FacetTrigger({
  active,
  icon,
  label,
  ariaLabel,
  className,
  ...props
}: FacetTriggerProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={ariaLabel ?? label}
      className={cn(
        "gap-1.5 ring-1 ring-foreground/15",
        active &&
          "border-transparent bg-primary/10 text-primary ring-primary/30 hover:bg-primary/15 hover:text-primary",
        className
      )}
      {...props}
    >
      {icon}
      {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// BrandFacet — single-select for v1 (per brief; matches the URL contract).
// ---------------------------------------------------------------------------

export function BrandFacet({ brands }: { brands: BrandOption[] }) {
  const { query, setQuery } = useLibraryQuery();
  const active = !!query.brand;
  const selected = brands.find((b) => b.id === query.brand);
  const label = selected ? truncate(selected.name, 18) : "Brand";

  return (
    <Popover>
      <PopoverTrigger
        render={
          <FacetTrigger
            active={active}
            icon={<Building2 className="size-3.5" aria-hidden />}
            label={label}
            ariaLabel={
              active
                ? `Brand filter — ${selected?.name ?? "selected"}`
                : "Brand filter"
            }
          />
        }
      />
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Search brands…" />
          <CommandList>
            <CommandEmpty>No brands.</CommandEmpty>
            <CommandGroup>
              {brands.map((b) => {
                const checked = query.brand === b.id;
                return (
                  <CommandItem
                    key={b.id}
                    value={b.name}
                    data-checked={checked || undefined}
                    onSelect={() =>
                      setQuery({ brand: checked ? null : b.id })
                    }
                    className="gap-2"
                  >
                    {b.isPersonal ? (
                      <Avatar size="sm" className="size-5">
                        {b.ownerImage ? (
                          <AvatarImage src={b.ownerImage} alt="" />
                        ) : null}
                        <AvatarFallback className="text-[10px]">
                          {initialsFor(b.name)}
                        </AvatarFallback>
                      </Avatar>
                    ) : null}
                    <span className="truncate">{b.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// CampaignFacet — single-select for v1.
// ---------------------------------------------------------------------------

export function CampaignFacet({
  campaigns,
}: {
  campaigns: CampaignOption[];
}) {
  const { query, setQuery } = useLibraryQuery();
  const active = !!query.campaign;
  const selected = campaigns.find((c) => c.id === query.campaign);
  const label = selected ? truncate(selected.name, 18) : "Campaign";

  return (
    <Popover>
      <PopoverTrigger
        render={
          <FacetTrigger
            active={active}
            icon={<Megaphone className="size-3.5" aria-hidden />}
            label={label}
            ariaLabel={
              active
                ? `Campaign filter — ${selected?.name ?? "selected"}`
                : "Campaign filter"
            }
          />
        }
      />
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Search campaigns…" />
          <CommandList>
            <CommandEmpty>No campaigns.</CommandEmpty>
            <CommandGroup>
              {campaigns.map((c) => {
                const checked = query.campaign === c.id;
                return (
                  <CommandItem
                    key={c.id}
                    value={c.name}
                    data-checked={checked || undefined}
                    onSelect={() =>
                      setQuery({ campaign: checked ? null : c.id })
                    }
                  >
                    {c.name}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// TagFacet — multi-select with OR/AND switcher at the top of the body.
// ---------------------------------------------------------------------------

export function TagFacet({ tags }: { tags: TagOption[] }) {
  const { query, setQuery, toggleTag } = useLibraryQuery();
  const count = query.tags.length;
  const active = count > 0;
  const label =
    count === 0
      ? "Tag"
      : count === 1
      ? truncate(
          tags.find((t) => t.id === query.tags[0])?.label ?? query.tags[0],
          16
        )
      : `${count} tags`;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <FacetTrigger
            active={active}
            icon={<TagIcon className="size-3.5" aria-hidden />}
            label={label}
            ariaLabel={
              active
                ? `Tag filter — ${count} selected`
                : "Tag filter"
            }
          />
        }
      />
      <PopoverContent align="start" className="w-72 p-0">
        <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5 text-xs text-muted-foreground">
          <span className="font-medium">Match</span>
          <TagOpToggle
            value={query.tagOp}
            onChange={(tagOp) => setQuery({ tagOp })}
            disabled={count < 2}
          />
        </div>
        <Command>
          <CommandInput placeholder="Search tags…" />
          <CommandList>
            <CommandEmpty>No tags.</CommandEmpty>
            <CommandGroup>
              {tags.map((t) => {
                const checked = query.tags.includes(t.id);
                return (
                  <CommandItem
                    key={t.id}
                    value={t.label}
                    data-checked={checked || undefined}
                    onSelect={() => toggleTag(t.id)}
                  >
                    {t.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function TagOpToggle({
  value,
  onChange,
  disabled,
}: {
  value: TagOp;
  onChange: (next: TagOp) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Tag match mode"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md bg-muted/40 p-0.5 text-[11px] font-medium",
        disabled && "opacity-50"
      )}
    >
      {(["or", "and"] as const).map((op) => {
        const selected = value === op;
        return (
          <button
            key={op}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(op)}
            className={cn(
              "rounded-sm px-2 py-0.5 transition-colors",
              selected
                ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/10"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {op === "or" ? "Any (OR)" : "All (AND)"}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// More — Source + Status sections inside one Popover.
// ---------------------------------------------------------------------------

interface MoreProps {
  children: React.ReactNode;
}

function More({ children }: MoreProps) {
  const { query } = useLibraryQuery();
  const moreCount = query.sources.length + query.statuses.length;
  const active = moreCount > 0;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={
              active ? `More filters — ${moreCount} selected` : "More filters"
            }
            className={cn(
              "gap-1.5",
              active && "bg-primary/10 text-primary hover:bg-primary/15"
            )}
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
            More
            {active && (
              <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 py-px text-[10px] font-semibold tabular-nums text-primary">
                {moreCount}
              </span>
            )}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-72 p-3">
        <div className="space-y-3">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// SourceFacet — checkbox list inside More. Empty selection = no filter.
// ---------------------------------------------------------------------------

const SOURCES: { value: AssetSource; label: string; icon: React.ReactNode }[] = [
  {
    value: "uploaded",
    label: "Uploaded",
    icon: <Upload className="size-3.5" aria-hidden />,
  },
  {
    value: "generated",
    label: "Generated",
    icon: <Sparkles className="size-3.5" aria-hidden />,
  },
  {
    value: "imported",
    label: "Imported",
    icon: <ImageDown className="size-3.5" aria-hidden />,
  },
];

export function SourceFacet() {
  const { query, setQuery } = useLibraryQuery();
  return (
    <FilterSection title="Source">
      {SOURCES.map((s) => (
        <CheckboxRow
          key={s.value}
          label={s.label}
          icon={s.icon}
          checked={query.sources.includes(s.value)}
          onChange={(checked) => {
            const next = checked
              ? Array.from(new Set([...query.sources, s.value]))
              : query.sources.filter((v) => v !== s.value);
            setQuery({ sources: next });
          }}
        />
      ))}
    </FilterSection>
  );
}

// ---------------------------------------------------------------------------
// StatusFacet — only renders when the user has multiple distinct statuses.
// `visible` is an explicit prop (not a boolean knob *on* the facet, but a
// composition gate so the parent can short-circuit cleanly).
// ---------------------------------------------------------------------------

const STATUSES: {
  value: AssetStatus;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "draft",
    label: "Draft",
    icon: <FileText className="size-3.5" aria-hidden />,
  },
  {
    value: "in_review",
    label: "In review",
    icon: <Hourglass className="size-3.5" aria-hidden />,
  },
  {
    value: "approved",
    label: "Approved",
    icon: <CheckCircle2 className="size-3.5" aria-hidden />,
  },
  {
    value: "rejected",
    label: "Rejected",
    icon: <XCircle className="size-3.5" aria-hidden />,
  },
  {
    value: "archived",
    label: "Archived",
    icon: <Archive className="size-3.5" aria-hidden />,
  },
];

export function StatusFacet({ visible = true }: { visible?: boolean }) {
  const { query, setQuery } = useLibraryQuery();
  if (!visible) return null;
  return (
    <FilterSection title="Status">
      {STATUSES.map((s) => (
        <CheckboxRow
          key={s.value}
          label={s.label}
          icon={s.icon}
          checked={query.statuses.includes(s.value)}
          onChange={(checked) => {
            const next = checked
              ? Array.from(new Set([...query.statuses, s.value]))
              : query.statuses.filter((v) => v !== s.value);
            setQuery({ statuses: next });
          }}
        />
      ))}
    </FilterSection>
  );
}

// ---------------------------------------------------------------------------
// Section + checkbox row primitives (local — not promoted to design system).
// ---------------------------------------------------------------------------

function FilterSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function CheckboxRow({
  label,
  icon,
  checked,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "group/row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm",
        "hover:bg-muted hover:text-foreground",
        checked && "bg-primary/10 text-primary hover:bg-primary/15",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-4 items-center justify-center rounded-sm border",
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-foreground/25"
        )}
      >
        {checked && (
          // Small inline check mark — avoid pulling in another Lucide icon.
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
      <span
        aria-hidden
        className={cn(
          "text-muted-foreground group-hover/row:text-foreground",
          checked && "text-primary"
        )}
      >
        {icon}
      </span>
      <span className="flex-1 truncate text-left">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Summary — renders only when filters are non-default. Hydrates names from
// the option lists passed in (so `brand=<uuid>` reads as the brand's name).
// ---------------------------------------------------------------------------

function Summary({
  brands,
  campaigns,
  tags,
}: {
  brands: BrandOption[];
  campaigns: CampaignOption[];
  tags: TagOption[];
}) {
  const { query, resultsCount, clearAll, activeCount } = useLibraryQuery();
  if (activeCount === 0) return null;

  const parts: string[] = [];
  if (query.brand) {
    const b = brands.find((x) => x.id === query.brand);
    if (b) parts.push(b.name);
  }
  if (query.campaign) {
    const c = campaigns.find((x) => x.id === query.campaign);
    if (c) parts.push(c.name);
  }
  if (query.tags.length === 1) {
    const t = tags.find((x) => x.id === query.tags[0]);
    if (t) parts.push(t.label);
  } else if (query.tags.length > 1) {
    parts.push(`${query.tags.length} tags`);
  }
  if (query.sources.length === 1) {
    parts.push(capitalize(query.sources[0]));
  } else if (query.sources.length > 1) {
    parts.push(`${query.sources.length} sources`);
  }
  if (query.statuses.length === 1) {
    parts.push(humanStatus(query.statuses[0]));
  } else if (query.statuses.length > 1) {
    parts.push(`${query.statuses.length} statuses`);
  }
  if (query.q) parts.push(`“${query.q}”`);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="truncate">
        Filtering by{" "}
        <span className="text-foreground">{parts.join(" · ")}</span>
        {resultsCount !== null && (
          <>
            {" "}
            <span className="text-muted-foreground/80">·</span>{" "}
            <span className="tabular-nums text-foreground">
              {formatCount(resultsCount)}
            </span>
          </>
        )}
      </span>
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
        onClick={clearAll}
        aria-label={`Clear ${activeCount} active filter${
          activeCount === 1 ? "" : "s"
        }`}
      >
        Clear all
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MobileSheet — staged filter editing for narrow viewports.
//
// Desktop facets push to the URL immediately. Mobile sheet stages changes
// locally and only commits on "Apply" — it's the only mode-difference
// between the two, by design (large numbers of filter changes on a small
// screen shouldn't each cause a navigation).
// ---------------------------------------------------------------------------

function MobileSheet({
  brands,
  campaigns,
  tags,
  hasMixedStatuses,
}: {
  brands: BrandOption[];
  campaigns: CampaignOption[];
  tags: TagOption[];
  hasMixedStatuses: boolean;
}) {
  const { query, setQuery, clearAll, activeCount } = useLibraryQuery();
  const [open, setOpen] = useState(false);
  const [staged, setStaged] = useState<LibraryQuery>(query);
  // Re-seed staged state on every open transition so partial edits from a
  // previous open don't leak. Render-time sync (React 19) — no effect needed.
  const [seededForOpen, setSeededForOpen] = useState(false);
  if (open && !seededForOpen) {
    setSeededForOpen(true);
    setStaged(query);
  } else if (!open && seededForOpen) {
    setSeededForOpen(false);
  }

  const stagedCount = countActive(staged);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={
              activeCount > 0
                ? `Filters — ${activeCount} active`
                : "Filters"
            }
            className={cn(
              "gap-1.5 md:hidden",
              activeCount > 0 &&
                "border-transparent bg-primary/10 text-primary ring-1 ring-primary/30"
            )}
          >
            <Filter className="size-3.5" aria-hidden />
            Filters
            {activeCount > 0 && (
              <span className="rounded-full bg-primary/20 px-1.5 py-px text-[10px] font-semibold tabular-nums">
                {activeCount}
              </span>
            )}
          </Button>
        }
      />
      <SheetContent
        side="bottom"
        className="max-h-[85vh] overflow-y-auto md:hidden"
      >
        <SheetHeader>
          <SheetTitle>Filter library</SheetTitle>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-4">
          <StagedSection title="Brand">
            <StagedRadioList
              options={brands.map((b) => ({ id: b.id, label: b.name }))}
              value={staged.brand}
              onChange={(v) => setStaged({ ...staged, brand: v })}
            />
          </StagedSection>
          <StagedSection title="Campaign">
            <StagedRadioList
              options={campaigns.map((c) => ({ id: c.id, label: c.name }))}
              value={staged.campaign}
              onChange={(v) => setStaged({ ...staged, campaign: v })}
            />
          </StagedSection>
          <StagedSection title="Tags">
            <div className="flex items-center justify-between pb-1.5 text-xs text-muted-foreground">
              <span className="font-medium">Match</span>
              <TagOpToggle
                value={staged.tagOp}
                onChange={(tagOp) => setStaged({ ...staged, tagOp })}
                disabled={staged.tags.length < 2}
              />
            </div>
            <StagedCheckboxList
              options={tags.map((t) => ({ id: t.id, label: t.label }))}
              values={staged.tags}
              onChange={(tags) => setStaged({ ...staged, tags })}
            />
          </StagedSection>
          <StagedSection title="Source">
            <StagedCheckboxList
              options={SOURCES.map((s) => ({ id: s.value, label: s.label }))}
              values={staged.sources}
              onChange={(sources) =>
                setStaged({
                  ...staged,
                  sources: sources as AssetSource[],
                })
              }
            />
          </StagedSection>
          {hasMixedStatuses && (
            <StagedSection title="Status">
              <StagedCheckboxList
                options={STATUSES.map((s) => ({
                  id: s.value,
                  label: s.label,
                }))}
                values={staged.statuses}
                onChange={(statuses) =>
                  setStaged({
                    ...staged,
                    statuses: statuses as AssetStatus[],
                  })
                }
              />
            </StagedSection>
          )}
        </div>
        <SheetFooter className="sticky bottom-0 flex-row items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setStaged(EMPTY_LIBRARY_QUERY);
              clearAll();
              setOpen(false);
            }}
          >
            Reset
          </Button>
          <Button
            type="button"
            onClick={() => {
              setQuery(staged);
              setOpen(false);
            }}
          >
            Apply
            {stagedCount > 0 && (
              <span className="ml-1 rounded-full bg-primary-foreground/20 px-1.5 py-px text-[10px] font-semibold tabular-nums">
                {stagedCount}
              </span>
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function StagedSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

function StagedRadioList({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <div className="space-y-0.5">
      {options.map((opt) => {
        const checked = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(checked ? null : opt.id)}
            className={cn(
              "flex w-full items-center justify-between rounded-md px-2 py-2 text-sm",
              checked
                ? "bg-primary/10 text-primary"
                : "hover:bg-muted hover:text-foreground"
            )}
          >
            <span className="truncate">{opt.label}</span>
            {checked && (
              <span className="text-[11px] font-medium">Selected</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function StagedCheckboxList({
  options,
  values,
  onChange,
}: {
  options: { id: string; label: string }[];
  values: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-0.5">
      {options.map((opt) => {
        const checked = values.includes(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            role="checkbox"
            aria-checked={checked}
            onClick={() => {
              const next = checked
                ? values.filter((v) => v !== opt.id)
                : [...values, opt.id];
              onChange(next);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm",
              checked
                ? "bg-primary/10 text-primary"
                : "hover:bg-muted hover:text-foreground"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex size-4 items-center justify-center rounded-sm border",
                checked
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-foreground/25"
              )}
            >
              {checked && (
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
            <span className="flex-1 truncate text-left">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function humanStatus(s: AssetStatus): string {
  switch (s) {
    case "in_review":
      return "In review";
    default:
      return capitalize(s);
  }
}

function formatCount(n: number): string {
  return `${n.toLocaleString()} result${n === 1 ? "" : "s"}`;
}

/**
 * Helper: resolve a partial query → URL string. Useful for tests + the
 * "Drop X filter" affordance once the API returns dropFilterCounts.
 */
export function buildLibraryUrl(query: Partial<LibraryQuery>): string {
  const merged = { ...EMPTY_LIBRARY_QUERY, ...query };
  const qs = serializeLibraryQuery(merged).toString();
  return `/library${qs ? `?${qs}` : ""}`;
}

// ---------------------------------------------------------------------------
// Compound API
// ---------------------------------------------------------------------------

FilterBar.Search = Search;
FilterBar.Facets = Facets;
FilterBar.More = More;
FilterBar.Summary = Summary;
FilterBar.MobileSheet = MobileSheet;
