import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brands, brandMembers } from "@/lib/db/schema";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { env } from "@/lib/env";
import { getCurrentWorkspace, listUserWorkspaces } from "@/lib/workspace/context";
import { loadRoleContext, isWorkspaceAdmin } from "@/lib/workspace/permissions";
import { getAssetUrl } from "@/lib/storage";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const user = {
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
    role: session.user.role ?? "member",
  };

  const userId = session.user.id as string;

  // Workspace context for the sidebar (T139). Resolved once per request and
  // passed down so the sidebar's WorkspaceSwitcher / BrandList don't have to
  // round-trip the DB on hydrate.
  const workspace = await getCurrentWorkspace(userId);
  const memberships = workspace ? await listUserWorkspaces(userId) : [];

  let sidebarBrands: Array<{
    id: string;
    name: string;
    slug: string | null;
    color: string;
    isPersonal: boolean;
    ownerId: string | null;
    logoUrl: string | null;
  }> = [];
  let canCreateBrandFlag = false;
  if (workspace) {
    const ctx = await loadRoleContext(userId, workspace.id);
    canCreateBrandFlag = isWorkspaceAdmin(ctx);
    const baseSelect = {
      id: brands.id,
      name: brands.name,
      slug: brands.slug,
      color: brands.color,
      isPersonal: brands.isPersonal,
      ownerId: brands.ownerId,
      logoR2Key: brands.logoR2Key,
    } as const;
    const rawRows = isWorkspaceAdmin(ctx)
      ? await db
          .select(baseSelect)
          .from(brands)
          .where(eq(brands.workspaceId, workspace.id))
          .orderBy(brands.name)
      : await db
          .select(baseSelect)
          .from(brands)
          .innerJoin(brandMembers, eq(brandMembers.brandId, brands.id))
          .where(
            and(
              eq(brands.workspaceId, workspace.id),
              eq(brandMembers.userId, userId)
            )
          )
          .orderBy(brands.name);
    sidebarBrands = await Promise.all(
      rawRows.map(async (r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        color: r.color,
        isPersonal: r.isPersonal,
        ownerId: r.ownerId,
        logoUrl: r.logoR2Key ? await getAssetUrl(r.logoR2Key) : null,
      }))
    );
  }

  const cookieStore = await cookies();
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar
        user={user}
        workspaceContext={
          workspace
            ? {
                current: {
                  id: workspace.id,
                  name: workspace.name,
                  slug: workspace.slug,
                  logoUrl: workspace.logoUrl,
                  role: (memberships.find((m) => m.id === workspace.id)?.role ??
                    "member") as "owner" | "admin" | "member",
                },
                memberships: memberships.map((m) => ({
                  id: m.id,
                  name: m.name,
                  slug: m.slug,
                  role: m.role as "owner" | "admin" | "member",
                })),
                mode: workspace.mode,
                brands: sidebarBrands,
                canCreateBrand: canCreateBrandFlag,
                sharedWithYouEnabled: env.FEATURE_SHARED_WITH_YOU,
              }
            : null
        }
      />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/50 px-4 md:hidden">
          <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
        </header>
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
