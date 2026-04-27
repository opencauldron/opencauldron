/**
 * GET /api/reviews/pending
 *
 * Pending-review queue counts per brand, scoped to the brands the current user
 * has approval rights on:
 *   - workspace owner/admin: every non-Personal brand in their workspace
 *   - brand_manager: only the brands where they hold that role
 *
 * Personal brands are excluded — their assets cannot enter `in_review` (FR-006b).
 *
 * Returns: [{ brandId, brandName, brandSlug, brandColor, pendingCount }] sorted
 * by pendingCount desc, then brand name. Empty list when the user manages no
 * brands. Single SQL grouped by brand.
 */
import { NextResponse } from "next/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets, brandMembers, brands } from "@/lib/db/schema";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import { loadRoleContext } from "@/lib/workspace/permissions";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const workspace = await getCurrentWorkspace(userId);
  if (!workspace) {
    return NextResponse.json({ brands: [] });
  }

  const ctx = await loadRoleContext(userId, workspace.id);
  if (!ctx.workspace) {
    return NextResponse.json({ brands: [] });
  }

  const isAdmin =
    ctx.workspace.role === "owner" || ctx.workspace.role === "admin";

  // Build the set of brandIds the user can approve on.
  let manageableBrandIds: string[] = [];
  if (isAdmin) {
    const rows = await db
      .select({ id: brands.id })
      .from(brands)
      .where(
        and(
          eq(brands.workspaceId, workspace.id),
          eq(brands.isPersonal, false)
        )
      );
    manageableBrandIds = rows.map((r) => r.id);
  } else {
    const rows = await db
      .select({ brandId: brandMembers.brandId })
      .from(brandMembers)
      .innerJoin(brands, eq(brands.id, brandMembers.brandId))
      .where(
        and(
          eq(brandMembers.userId, userId),
          eq(brandMembers.role, "brand_manager"),
          eq(brands.workspaceId, workspace.id),
          eq(brands.isPersonal, false)
        )
      );
    manageableBrandIds = rows.map((r) => r.brandId);
  }

  if (manageableBrandIds.length === 0) {
    return NextResponse.json({ brands: [] });
  }

  // Single grouped SQL: every manageable brand gets a row even when its
  // pending count is zero (LEFT JOIN on `assets` filtered to in_review).
  const rows = await db
    .select({
      brandId: brands.id,
      brandName: brands.name,
      brandSlug: brands.slug,
      brandColor: brands.color,
      pendingCount: sql<number>`count(${assets.id})::int`,
    })
    .from(brands)
    .leftJoin(
      assets,
      and(eq(assets.brandId, brands.id), eq(assets.status, "in_review"))
    )
    .where(inArray(brands.id, manageableBrandIds))
    .groupBy(brands.id, brands.name, brands.slug, brands.color)
    .orderBy(desc(sql<number>`count(${assets.id})`), asc(brands.name));

  return NextResponse.json({
    brands: rows.map((r) => ({
      brandId: r.brandId,
      brandName: r.brandName,
      brandSlug: r.brandSlug,
      brandColor: r.brandColor,
      pendingCount: Number(r.pendingCount ?? 0),
    })),
    totalPending: rows.reduce((s, r) => s + Number(r.pendingCount ?? 0), 0),
  });
}
