/**
 * Brand shell layout (T142a / FR-027 / FR-033).
 *
 * Resolves the brand by slug in the current workspace. Asserts read access:
 * a workspace member with no `brand_members` row gets a 404 (FR-033). Renders
 * tab nav; the Review tab is conditional on brand_manager+.
 *
 * The Personal-brand sentinel slug `personal` resolves to the current user's
 * Personal brand for this workspace via `(workspaceId, isPersonal=true,
 * ownerId=me)` — see the `getCurrentWorkspace` lookup below.
 */

import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import {
  isBrandManager,
  isBrandMember,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { BrandTabs } from "./brand-tabs";

interface BrandShellProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function BrandShellLayout({
  children,
  params,
}: BrandShellProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");

  const userId = session.user.id;
  const workspace = await getCurrentWorkspace(userId);
  if (!workspace) notFound();

  const { slug } = await params;

  // Personal-brand sentinel — the slug "personal" resolves dynamically per
  // user (FR-006).
  const [brand] =
    slug === "personal"
      ? await db
          .select({
            id: brands.id,
            name: brands.name,
            slug: brands.slug,
            color: brands.color,
            isPersonal: brands.isPersonal,
            ownerId: brands.ownerId,
          })
          .from(brands)
          .where(
            and(
              eq(brands.workspaceId, workspace.id),
              eq(brands.isPersonal, true),
              eq(brands.ownerId, userId)
            )
          )
          .limit(1)
      : await db
          .select({
            id: brands.id,
            name: brands.name,
            slug: brands.slug,
            color: brands.color,
            isPersonal: brands.isPersonal,
            ownerId: brands.ownerId,
          })
          .from(brands)
          .where(
            and(eq(brands.workspaceId, workspace.id), eq(brands.slug, slug))
          )
          .limit(1);

  if (!brand) notFound();

  const ctx = await loadRoleContext(userId, workspace.id);

  // FR-033 — workspace member with no brand_member row → 404 (not 403). The
  // Personal-brand owner always has implicit access to their own brand.
  const personalOwner = brand.isPersonal && brand.ownerId === userId;
  if (!personalOwner && !isBrandMember(ctx, brand.id)) notFound();

  const canManage = isBrandManager(ctx, brand.id);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: brand.color }}
            aria-hidden
          />
          <h1 className="text-2xl font-bold tracking-tight">{brand.name}</h1>
          {brand.isPersonal && (
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              personal
            </span>
          )}
        </div>
        <BrandTabs
          slug={brand.isPersonal ? "personal" : (brand.slug ?? brand.id)}
          showReview={canManage && !brand.isPersonal}
        />
      </header>
      <div>{children}</div>
    </div>
  );
}
