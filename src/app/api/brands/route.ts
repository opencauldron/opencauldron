import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets, brandMembers, brands } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import { loadRoleContext, canCreateBrand } from "@/lib/workspace/permissions";

const HEX = /^#[0-9a-fA-F]{6}$/;

const createSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, "slug must be kebab-case").optional(),
  color: z.string().regex(HEX).default("#6366f1"),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "brand";
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const workspace = await getCurrentWorkspace(session.user.id);
  if (!workspace) return NextResponse.json([]);

  const ctx = await loadRoleContext(session.user.id, workspace.id);
  const adminOverride = ctx.workspace?.role === "owner" || ctx.workspace?.role === "admin";

  // Workspace owner/admin sees every brand in the workspace; others only the
  // brands they have a brand_members row on (FR-027 / sidebar plan).
  const rows = adminOverride
    ? await db
        .select({
          id: brands.id,
          name: brands.name,
          slug: brands.slug,
          color: brands.color,
          isPersonal: brands.isPersonal,
          ownerId: brands.ownerId,
          createdBy: brands.createdBy,
          createdAt: brands.createdAt,
          assetCount: sql<number>`(SELECT count(*)::int FROM ${assets} WHERE ${assets.brandId} = ${brands.id})`,
        })
        .from(brands)
        .where(eq(brands.workspaceId, workspace.id))
        .orderBy(brands.name)
    : await db
        .select({
          id: brands.id,
          name: brands.name,
          slug: brands.slug,
          color: brands.color,
          isPersonal: brands.isPersonal,
          ownerId: brands.ownerId,
          createdBy: brands.createdBy,
          createdAt: brands.createdAt,
          assetCount: sql<number>`(SELECT count(*)::int FROM ${assets} WHERE ${assets.brandId} = ${brands.id})`,
        })
        .from(brands)
        .innerJoin(brandMembers, eq(brandMembers.brandId, brands.id))
        .where(and(eq(brands.workspaceId, workspace.id), eq(brandMembers.userId, session.user.id)))
        .orderBy(brands.name);

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const workspace = await getCurrentWorkspace(session.user.id);
  if (!workspace) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const ctx = await loadRoleContext(session.user.id, workspace.id);
  if (!canCreateBrand(ctx)) {
    return NextResponse.json({ error: "Only workspace admins can create brands" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const slug = parsed.data.slug ?? slugify(parsed.data.name);

  try {
    const [brand] = await db
      .insert(brands)
      .values({
        workspaceId: workspace.id,
        name: parsed.data.name,
        slug,
        color: parsed.data.color,
        createdBy: session.user.id,
      })
      .returning();

    // The creator becomes the inaugural brand_manager (FR-038-flavored: a
    // brand always has at least one manager).
    await db
      .insert(brandMembers)
      .values({ brandId: brand.id, userId: session.user.id, role: "brand_manager" })
      .onConflictDoNothing();

    return NextResponse.json(brand, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("unique")) {
      return NextResponse.json(
        { error: "A brand with that name or slug already exists in this workspace" },
        { status: 409 }
      );
    }
    throw error;
  }
}
