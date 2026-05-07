"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  BarChart3,
  Check,
  ChevronUp,
  LogOut,
  Settings,
  Shield,
  Tags,
  Trophy,
  User,
  Zap,
} from "lucide-react";

interface StudioInfo {
  name: string;
  logoUrl: string | null;
}

interface UserMenuPopoverProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    role?: string;
  };
  studio: StudioInfo;
}

interface XpInfo {
  level: number;
  title: string;
  currentXP: number;
}

/**
 * User-card popover at the bottom of the sidebar. Shows email, current studio
 * (informational checkmark — single-tenant for now), account routes, and the
 * Lvl/XP badge that previously rendered in the user card. Admin row only
 * renders when `user.role === "admin"`.
 */
export function UserMenuPopover({ user, studio }: UserMenuPopoverProps) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [open, setOpen] = useState(false);
  const [xpInfo, setXpInfo] = useState<XpInfo | null>(null);

  const initials =
    user.name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase() ?? "?";

  // Pull XP for the popover's badge row. Same endpoint the sidebar previously
  // hit; relocating the data, not changing the source.
  useEffect(() => {
    fetch("/api/xp")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.level === "number") {
          setXpInfo(data);
        }
      })
      .catch(() => {});
  }, []);

  const isAdmin = user.role === "admin";
  const studioInitial = studio.name.charAt(0).toUpperCase() || "?";

  const handleSignOut = () => {
    setOpen(false);
    void signOut({ callbackUrl: "/login" });
  };

  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <SidebarMenuButton
              tooltip={user.name ?? user.email ?? "Account"}
              className="h-auto py-2.5"
            />
          }
        >
          <Avatar className="h-7 w-7 shrink-0 ring-2 ring-primary/20">
            <AvatarImage src={user.image ?? undefined} />
            <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col items-start group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium">{user.name}</span>
            <span className="truncate text-[11px] text-muted-foreground">
              {user.email}
            </span>
          </div>
          <ChevronUp className="ml-auto h-4 w-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align={isCollapsed ? "center" : "end"}
          sideOffset={isCollapsed ? 8 : 12}
          className="w-64 gap-0 border-sidebar-border bg-sidebar p-0 ring-sidebar-border/60"
        >
          {/* Email header */}
          <div className="px-3 pt-3 pb-2 text-[11px] font-medium text-muted-foreground/80 truncate">
            {user.email ?? user.name ?? "Account"}
          </div>

          {/* Current studio (informational checkmark — single-tenant for now) */}
          <div className="border-t border-sidebar-border/60">
            <div className="flex items-center gap-2.5 px-3 py-2.5">
              {studio.logoUrl ? (
                // Plain <img>: studio logoUrl is user-supplied so we skip
                // next/image's domain allow-list (matches the header).
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={studio.logoUrl}
                  alt={studio.name}
                  className="h-6 w-6 shrink-0 rounded object-cover"
                />
              ) : (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/10 text-[11px] font-semibold text-primary">
                  {studioInitial}
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">
                  {studio.name}
                </span>
                <span className="truncate text-[10px] text-muted-foreground">
                  Current studio
                </span>
              </div>
              <Check className="h-4 w-4 shrink-0 text-primary" />
            </div>
          </div>

          {/* Account links */}
          <div className="flex flex-col border-t border-sidebar-border/60 p-1">
            <PopoverNavItem
              href="/profile"
              icon={User}
              label="Profile"
              onClose={() => setOpen(false)}
            />
            <PopoverNavItem
              href="/settings/studio"
              icon={Settings}
              label="Studio settings"
              onClose={() => setOpen(false)}
            />
            <PopoverNavItem
              href="/brands"
              icon={Tags}
              label="Manage brands"
              onClose={() => setOpen(false)}
            />
            <PopoverNavItem
              href="/usage"
              icon={BarChart3}
              label="Usage"
              onClose={() => setOpen(false)}
            />
            {isAdmin && (
              <PopoverNavItem
                href="/admin"
                icon={Shield}
                label="Admin"
                onClose={() => setOpen(false)}
              />
            )}
          </div>

          {/* Lvl/XP — informational, links to leaderboard */}
          {xpInfo && (
            <Link
              href="/leaderboard"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 border-t border-sidebar-border/60 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-sidebar-accent"
            >
              <Trophy className="h-3.5 w-3.5 shrink-0" />
              <span>
                Lvl {xpInfo.level} {xpInfo.title} · {xpInfo.currentXP} XP
              </span>
              <Zap className="ml-auto h-3.5 w-3.5 shrink-0 text-primary/60" />
            </Link>
          )}

          {/* Log out */}
          <div className="border-t border-sidebar-border/60 p-1">
            <button
              type="button"
              onClick={handleSignOut}
              className="group/popover-item flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
            >
              <LogOut className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover/popover-item:text-foreground" />
              <span>Log out</span>
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}

function PopoverNavItem({
  href,
  icon: Icon,
  label,
  onClose,
}: {
  href: string;
  icon: typeof User;
  label: string;
  onClose: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className="group/popover-item flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover/popover-item:text-foreground" />
      <span>{label}</span>
    </Link>
  );
}
