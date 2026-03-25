"use client";

import { useEffect, useState } from "react";
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
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  WandSparkles,
  Images,
  Tags,
  BarChart3,
  Shield,
  LogOut,
  ChevronUp,
  Wand2,
  Trophy,
  User,
  Zap,
} from "lucide-react";

interface AppSidebarProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    role?: string;
  };
}

const navItems = [
  { title: "Generate", href: "/generate", icon: Wand2 },
  { title: "Gallery", href: "/gallery", icon: Images },
  { title: "Brands", href: "/brands", icon: Tags },
  { title: "Usage", href: "/usage", icon: BarChart3 },
  { title: "Leaderboard", href: "/leaderboard", icon: Trophy },
  { title: "Profile", href: "/profile", icon: User },
];

const adminItems = [
  { title: "Admin", href: "/admin", icon: Shield },
];

export function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname();
  const isAdmin = user.role === "admin";
  const initials = user.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase() ?? "?";

  const [xpInfo, setXpInfo] = useState<{ level: number; title: string; currentXP: number } | null>(null);

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

  return (
    <Sidebar>
      <SidebarHeader className="relative border-b border-sidebar-border px-4 py-4">
        {/* Subtle primary accent line at the top */}
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary/0 via-primary/80 to-primary/0" />
        <Link href="/" className="flex items-center gap-3">
          {process.env.NEXT_PUBLIC_ORG_LOGO ? (
            <img
              src={process.env.NEXT_PUBLIC_ORG_LOGO}
              alt={process.env.NEXT_PUBLIC_ORG_NAME ?? ""}
              className="h-9 w-9 rounded-xl"
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[oklch(0.50_0.22_280)] to-[oklch(0.40_0.20_300)] text-white shadow-lg shadow-primary/25">
              <WandSparkles className="h-[18px] w-[18px]" strokeWidth={1.5} />
            </div>
          )}
          <div>
            <h1 className="font-heading text-lg font-bold tracking-tight">
              {process.env.NEXT_PUBLIC_STUDIO_NAME ?? process.env.NEXT_PUBLIC_ORG_NAME ?? "OpenCauldron"}
            </h1>
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70">
              {process.env.NEXT_PUBLIC_ORG_NAME ? process.env.NEXT_PUBLIC_ORG_NAME : "Open Source"}
            </p>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      isActive={isActive}
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
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => {
                  const isActive = pathname.startsWith(item.href);

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        render={<Link href={item.href} />}
                        isActive={isActive}
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
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton className="h-auto py-2.5" />
                }
              >
                <Avatar className="h-7 w-7 ring-2 ring-primary/20">
                  <AvatarImage src={user.image ?? undefined} />
                  <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col items-start">
                  <span className="text-sm font-medium">{user.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {user.email}
                  </span>
                  {xpInfo && (
                    <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-primary">
                      <Zap className="h-3 w-3" />
                      Lvl {xpInfo.level} {xpInfo.title} · {xpInfo.currentXP} XP
                    </span>
                  )}
                </div>
                <ChevronUp className="ml-auto h-4 w-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" className="w-56">
                <DropdownMenuItem
                  onClick={() => {
                    window.location.href = "/api/auth/signout";
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
