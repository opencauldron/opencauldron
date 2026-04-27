"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  WandSparkles,
  Images,
  ChevronRight,
  Wand2,
  Trophy,
  Layers,
  FlaskConical,
  ImagePlus,
  HelpCircle,
  BookOpen,
  Bug,
  Info,
  Sparkles,
  ExternalLink,
  ClipboardCheck,
  LayoutDashboard,
  Users,
  Plus,
} from "lucide-react";
import { type Workspace } from "./workspace-switcher";
import { BrandList } from "./brand-list";
import { AddBrandDialog } from "./add-brand-dialog";
import { AboutModal } from "./about-modal";
import { UserMenuPopover } from "./user-menu-popover";
import {
  CHANGELOG,
  FULL_CHANGELOG_URL,
  WHATS_NEW_SEEN_KEY,
  getLatestChangelogDate,
} from "@/lib/changelog";
import { version as APP_VERSION } from "../../package.json";

function subscribeToWhatsNewSeen(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("opencauldron:whats-new-seen", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("opencauldron:whats-new-seen", callback);
    window.removeEventListener("storage", callback);
  };
}

function getWhatsNewSeenSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(WHATS_NEW_SEEN_KEY);
}

function getServerSnapshot(): string | null {
  return null;
}

interface SidebarBrand {
  id: string;
  name: string;
  slug: string | null;
  color: string;
  isPersonal: boolean;
  ownerId: string | null;
  logoUrl?: string | null;
}

interface WorkspaceContext {
  current: Workspace;
  memberships: Workspace[];
  mode: "hosted" | "self_hosted";
  brands: SidebarBrand[];
  canCreateBrand: boolean;
  sharedWithYouEnabled: boolean;
}

interface AppSidebarProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    role?: string;
  };
  workspaceContext: WorkspaceContext | null;
}

type NavItem = {
  title: string;
  href: string;
  icon: typeof Wand2;
  /** Match `pathname === href` instead of `startsWith`. Use for items whose
   *  href is a parent route of unrelated sibling nav (e.g. `/brands` vs
   *  `/brands/[slug]`). */
  exact?: boolean;
};

// Top section — workspace-wide chrome shared by every brand. Generate moved
// out into a dedicated "+ Create" CTA above this list.
const topNavItems: NavItem[] = [
  { title: "Overview", href: "/overview", icon: LayoutDashboard },
  { title: "Gallery", href: "/gallery", icon: Images },
];

// LIBRARY section — workspace-wide content surfaces.
const libraryNavItems: NavItem[] = [
  { title: "Brews", href: "/brews", icon: FlaskConical },
  { title: "References", href: "/references", icon: ImagePlus },
  { title: "LoRAs", href: "/loras", icon: Layers },
];

const sharedWithYouItem: NavItem = {
  title: "Shared with you",
  href: "/shared",
  icon: Users,
};

const reviewNavItem: NavItem = {
  title: "Review",
  href: "/review",
  icon: ClipboardCheck,
};

const leaderboardNavItem: NavItem = {
  title: "Leaderboard",
  href: "/leaderboard",
  icon: Trophy,
};

/**
 * Review-queue sidebar entry. Polls `/api/reviews/pending` so the badge stays
 * approximately fresh; hidden entirely for users with no brand-manager role
 * (the API returns an empty list there, so we collapse to null).
 */
function ReviewNavLink({ pathname }: { pathname: string }) {
  const item = reviewNavItem;
  const isActive = pathname.startsWith(item.href);
  const [count, setCount] = useState<number | null>(null);
  const [hasAccess, setHasAccess] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/reviews/pending", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          brands: { brandId: string }[];
          totalPending: number;
        };
        if (cancelled) return;
        setHasAccess(data.brands.length > 0);
        setCount(data.totalPending);
      } catch {
        /* silent */
      }
    };
    load();
    const refresh = () => load();
    window.addEventListener("opencauldron:review-changed", refresh);
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("opencauldron:review-changed", refresh);
    };
  }, []);

  if (!hasAccess) return null;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={item.href} />}
        isActive={isActive}
        tooltip={
          count && count > 0 ? `${item.title} (${count} pending)` : item.title
        }
        className={`group/nav transition-all duration-200 hover:translate-x-0.5 ${
          isActive
            ? "border-l-2 border-primary bg-primary/10 text-primary font-medium"
            : "border-l-2 border-transparent"
        }`}
      >
        <item.icon
          className={`h-4 w-4 shrink-0 transition-colors duration-200 ${
            isActive
              ? "text-primary"
              : "text-muted-foreground group-hover/nav:text-foreground"
          }`}
        />
        <span>{item.title}</span>
        {count != null && count > 0 && (
          <span
            aria-label={`${count} pending review`}
            className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground group-data-[collapsible=icon]:hidden"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive =
    item.href === "/" || item.exact
      ? pathname === item.href
      : pathname.startsWith(item.href);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={item.href} />}
        isActive={isActive}
        tooltip={item.title}
        className={`group/nav transition-all duration-200 hover:translate-x-0.5 ${
          isActive
            ? "border-l-2 border-primary bg-primary/10 text-primary font-medium"
            : "border-l-2 border-transparent"
        }`}
      >
        <item.icon
          className={`h-4 w-4 shrink-0 transition-colors duration-200 ${
            isActive
              ? "text-primary"
              : "text-muted-foreground group-hover/nav:text-foreground"
          }`}
        />
        <span>{item.title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar({ user, workspaceContext }: AppSidebarProps) {
  const pathname = usePathname();

  const [helpOpen, setHelpOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const lastSeen = useSyncExternalStore(
    subscribeToWhatsNewSeen,
    getWhatsNewSeenSnapshot,
    getServerSnapshot
  );
  const hasUnread = getLatestChangelogDate() > (lastSeen ?? "");

  const handleWhatsNewOpenChange = (open: boolean) => {
    setWhatsNewOpen(open);
    if (open && typeof window !== "undefined") {
      localStorage.setItem(WHATS_NEW_SEEN_KEY, getLatestChangelogDate());
      window.dispatchEvent(new Event("opencauldron:whats-new-seen"));
    }
  };

  const openBugReport = () => {
    const params = new URLSearchParams({
      template: "bug_report.yml",
      labels: "bug",
      version: process.env.NEXT_PUBLIC_APP_VERSION ?? "",
      browser: typeof navigator !== "undefined" ? navigator.userAgent : "",
      url: typeof window !== "undefined" ? window.location.href : "",
    });
    window.open(
      `https://github.com/opencauldron/opencauldron/issues/new?${params.toString()}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const [addBrandOpen, setAddBrandOpen] = useState(false);

  // Studio-driven branding (header). Source of truth: the current workspace
  // record (Settings → Studio writes name/slug/logoUrl). Falls back to env
  // vars when the workspace context is missing (pre-bootstrap render), and
  // ultimately to an OpenCauldron default for the OSS unbranded experience.
  const studioName =
    workspaceContext?.current.name ??
    process.env.NEXT_PUBLIC_STUDIO_NAME ??
    process.env.NEXT_PUBLIC_ORG_NAME ??
    "OpenCauldron";
  const studioLogoUrl =
    workspaceContext?.current.logoUrl ??
    process.env.NEXT_PUBLIC_ORG_LOGO ??
    null;

  // BRANDS section visibility: render the section as long as the user has
  // any brand context (real, personal, or the ability to create one). The
  // BrandList itself partitions Personal vs. real brands.
  const allBrands = workspaceContext?.brands ?? [];
  const showBrandsSection =
    !!workspaceContext &&
    (allBrands.length > 0 || workspaceContext.canCreateBrand);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="relative border-b border-sidebar-border px-4 py-4 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-3">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary/0 via-primary/80 to-primary/0" />
        <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
          <Link
            href="/settings/studio"
            className="group/studio flex flex-1 items-center gap-3 overflow-hidden rounded-md transition-colors hover:bg-sidebar-accent/50 group-data-[collapsible=icon]:hidden"
            aria-label={`${studioName} — open studio settings`}
          >
            {studioLogoUrl ? (
              // Plain <img>: studio logoUrl is user-supplied, so we skip
              // next/image's domain allow-list. Env-var fallback uses the
              // same path for consistency.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={studioLogoUrl}
                alt={studioName}
                className="h-9 w-9 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[oklch(0.50_0.22_280)] to-[oklch(0.40_0.20_300)] text-white shadow-lg shadow-primary/25">
                <WandSparkles className="h-[18px] w-[18px]" strokeWidth={1.5} />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate font-heading text-lg font-bold tracking-tight">
                {studioName}
              </h1>
              <p className="truncate text-[11px] text-muted-foreground/70">
                OpenCauldron v{APP_VERSION}
              </p>
            </div>
          </Link>
          <SidebarTrigger className="-mr-1 shrink-0 text-muted-foreground hover:text-foreground group-data-[collapsible=icon]:mr-0" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* + Create CTA — primary action button. Lives directly under the
            header so the create flow is always one click away. Hidden in
            collapsed (icon-only) mode where the icon-rail provides nav. */}
        <SidebarGroup className="pt-3 pb-1 group-data-[collapsible=icon]:hidden">
          <SidebarGroupContent>
            <Button
              render={<Link href="/generate" />}
              nativeButton={false}
              variant="default"
              size="default"
              className="h-9 w-full justify-center gap-2"
            >
              <Plus className="h-4 w-4" />
              <span>Create</span>
            </Button>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Top nav: Overview / Gallery / Review */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {topNavItems.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
              <ReviewNavLink pathname={pathname} />
              {workspaceContext?.sharedWithYouEnabled && (
                <NavLink item={sharedWithYouItem} pathname={pathname} />
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* BRANDS section: real brands → Personal → "+ Add brand". The
            section header includes a gear icon → /brands (manage brands). */}
        {showBrandsSection && (
          <BrandList
            initialBrands={allBrands}
            pathname={pathname}
            trailing={
              workspaceContext?.canCreateBrand ? (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => setAddBrandOpen(true)}
                    tooltip="Add brand"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-4 w-4 shrink-0" />
                    <span>Add brand</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null
            }
          />
        )}

        {/* LIBRARY section — workspace-wide content surfaces. */}
        <SidebarGroup>
          <SidebarGroupLabel>LIBRARY</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {libraryNavItems.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Spacer pushes Leaderboard / Help / What's New to the bottom of
            the content area, just above the user footer card. */}
        <SidebarGroup className="mt-auto border-t border-sidebar-border/60 pt-2">
          <SidebarGroupContent>
            <SidebarMenu>
              <NavLink item={leaderboardNavItem} pathname={pathname} />
              <HelpMenuItem
                helpOpen={helpOpen}
                setHelpOpen={setHelpOpen}
                openBugReport={openBugReport}
                onAboutClick={() => setAboutOpen(true)}
              />
              <WhatsNewMenuItem
                open={whatsNewOpen}
                onOpenChange={handleWhatsNewOpenChange}
                hasUnread={hasUnread}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <UserMenuPopover
            user={user}
            studio={{ name: studioName, logoUrl: studioLogoUrl }}
          />
        </SidebarMenu>
      </SidebarFooter>
      <AboutModal open={aboutOpen} onOpenChange={setAboutOpen} />
      {workspaceContext?.canCreateBrand && (
        <AddBrandDialog
          open={addBrandOpen}
          onOpenChange={setAddBrandOpen}
          onAdded={(brand) => {
            // Soft refresh — let the BrandList focus listener pick the new
            // brand up on its next refetch instead of forcing a full reload.
            if (brand.slug) {
              window.location.assign(`/brands/${brand.slug}`);
            }
          }}
        />
      )}
    </Sidebar>
  );
}

function HelpMenuItem({
  helpOpen,
  setHelpOpen,
  openBugReport,
  onAboutClick,
}: {
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  openBugReport: () => void;
  onAboutClick: () => void;
}) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <SidebarMenuItem>
      <Popover open={helpOpen} onOpenChange={setHelpOpen}>
        <PopoverTrigger
          render={
            <SidebarMenuButton
              isActive={helpOpen}
              tooltip={isCollapsed ? "Help" : undefined}
              className={`group/nav border-l-2 transition-all duration-200 hover:translate-x-0.5 ${
                helpOpen
                  ? "border-primary/60 bg-sidebar-accent text-foreground"
                  : "border-transparent"
              }`}
            />
          }
        >
          <HelpCircle
            className={`h-4 w-4 shrink-0 transition-colors duration-200 ${
              helpOpen
                ? "text-primary"
                : "text-muted-foreground group-hover/nav:text-foreground"
            }`}
          />
          <span>Help</span>
          <ChevronRight
            className={`ml-auto h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[collapsible=icon]:hidden ${
              helpOpen ? "translate-x-0.5 text-foreground" : ""
            }`}
          />
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align={isCollapsed ? "center" : "end"}
          sideOffset={isCollapsed ? 8 : 12}
          className="w-56 gap-0 border-sidebar-border bg-sidebar p-1.5 ring-sidebar-border/60"
        >
          <div className="px-2 pt-1.5 pb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            Help
          </div>
          <a
            href="https://docs.opencauldron.ai"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setHelpOpen(false)}
            className="group/help flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-sidebar-foreground transition-all duration-150 hover:translate-x-0.5 hover:bg-sidebar-accent"
          >
            <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover/help:text-primary" />
            <span>Documentation</span>
          </a>
          <button
            type="button"
            onClick={() => {
              setHelpOpen(false);
              openBugReport();
            }}
            className="group/help flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm text-sidebar-foreground transition-all duration-150 hover:translate-x-0.5 hover:bg-sidebar-accent"
          >
            <Bug className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover/help:text-primary" />
            <span>Report a bug</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setHelpOpen(false);
              onAboutClick();
            }}
            className="group/help flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm text-sidebar-foreground transition-all duration-150 hover:translate-x-0.5 hover:bg-sidebar-accent"
          >
            <Info className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover/help:text-primary" />
            <span>About</span>
          </button>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}

function WhatsNewMenuItem({
  open,
  onOpenChange,
  hasUnread,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasUnread: boolean;
}) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const entries = CHANGELOG.slice(0, 5);

  const formatDate = (iso: string) =>
    new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger
          render={
            <SidebarMenuButton
              isActive={open}
              tooltip={isCollapsed ? "What's New" : undefined}
              className={`group/nav border-l-2 transition-all duration-200 hover:translate-x-0.5 ${
                open
                  ? "border-primary/60 bg-sidebar-accent text-foreground"
                  : "border-transparent"
              }`}
            />
          }
        >
          <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
            <Sparkles
              className={`h-4 w-4 transition-colors duration-200 ${
                open
                  ? "text-primary"
                  : "text-muted-foreground group-hover/nav:text-foreground"
              }`}
            />
            {hasUnread && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/70" />
                <span className="relative h-2 w-2 rounded-full bg-primary ring-2 ring-sidebar" />
              </span>
            )}
          </span>
          <span>What&apos;s New</span>
          <ChevronRight
            className={`ml-auto h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[collapsible=icon]:hidden ${
              open ? "translate-x-0.5 text-foreground" : ""
            }`}
          />
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align={isCollapsed ? "center" : "end"}
          sideOffset={isCollapsed ? 8 : 12}
          className="w-80 gap-0 border-sidebar-border bg-sidebar p-0 ring-sidebar-border/60"
        >
          <div className="flex items-center justify-between px-3 pt-3 pb-2">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              What&apos;s New
            </div>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
              v{process.env.NEXT_PUBLIC_APP_VERSION ?? ""}
            </span>
          </div>
          <div className="max-h-80 overflow-y-auto px-1">
            <ol className="flex flex-col gap-1 pb-2">
              {entries.map((entry, i) => (
                <li
                  key={entry.date + entry.title}
                  className="relative rounded-md px-2 py-2"
                >
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-medium text-foreground">
                      {entry.title}
                    </h3>
                    <time
                      dateTime={entry.date}
                      className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/70"
                    >
                      {formatDate(entry.date)}
                    </time>
                  </div>
                  <ul className="ml-3 flex flex-col gap-0.5 text-xs text-muted-foreground">
                    {entry.bullets.map((b) => (
                      <li
                        key={b}
                        className="relative pl-3 before:absolute before:top-[7px] before:left-0 before:h-1 before:w-1 before:rounded-full before:bg-muted-foreground/40"
                      >
                        {b}
                      </li>
                    ))}
                  </ul>
                  {i < entries.length - 1 && (
                    <div className="absolute right-2 -bottom-0.5 left-2 h-px bg-sidebar-border/40" />
                  )}
                </li>
              ))}
            </ol>
          </div>
          <a
            href={FULL_CHANGELOG_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onOpenChange(false)}
            className="group/cta flex items-center justify-between gap-2 border-t border-sidebar-border/60 bg-sidebar-accent/30 px-3 py-2.5 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
          >
            <span>Full changelog</span>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover/cta:text-primary" />
          </a>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}
