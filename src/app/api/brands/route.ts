import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets, brandMembers, brands, brews, users } from "@/lib/db/schema";
import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import { loadRoleContext, canCreateBrand } from "@/lib/workspace/permissions";
import { getAssetUrl } from "@/lib/storage";

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
  // We left-join `users` to surface the personal-brand owner's avatar so the
  // BrandMark can fall back to it without a second round-trip.
  const baseSelect = {
    id: brands.id,
    name: brands.name,
    slug: brands.slug,
    color: brands.color,
    isPersonal: brands.isPersonal,
    ownerId: brands.ownerId,
    videoEnabled: brands.videoEnabled,
    selfApprovalAllowed: brands.selfApprovalAllowed,
    createdBy: brands.createdBy,
    createdAt: brands.createdAt,
    logoR2Key: brands.logoR2Key,
    ownerImage: users.image,
    assetCount: sql<number>`(SELECT count(*)::int FROM ${assets} WHERE ${assets.brandId} = ${brands.id})`,
    brewCount: sql<number>`(SELECT count(*)::int FROM ${brews} WHERE ${brews.brandId} = ${brands.id})`,
  } as const;

  // Personal brands are private by design — every member sees only their own,
  // not their teammates'. The filter applies to both the admin and member
  // paths: a workspace admin browsing /brands shouldn't see seven "Personal"
  // rows for seven other people. Real (non-personal) brands behave per
  // FR-027: admins see all, members see those they're brand_members of.
  const ownPersonalOrRealBrand = or(
    eq(brands.isPersonal, false),
    eq(brands.ownerId, session.user.id)
  );

  const rows = adminOverride
    ? await db
        .select(baseSelect)
        .from(brands)
        .leftJoin(users, eq(users.id, brands.ownerId))
        .where(
          and(eq(brands.workspaceId, workspace.id), ownPersonalOrRealBrand)
        )
        .orderBy(brands.name)
    : await db
        .select(baseSelect)
        .from(brands)
        .innerJoin(brandMembers, eq(brandMembers.brandId, brands.id))
        .leftJoin(users, eq(users.id, brands.ownerId))
        .where(
          and(
            eq(brands.workspaceId, workspace.id),
            eq(brandMembers.userId, session.user.id),
            ownPersonalOrRealBrand
          )
        )
        .orderBy(brands.name);

  // Re-resolve logo keys to fresh signed URLs. Done in parallel — typically a
  // handful of brands per workspace, so the cost is trivial.
  const enriched = await Promise.all(
    rows.map(async (r) => {
      const logoUrl = r.logoR2Key ? await getAssetUrl(r.logoR2Key) : null;
      const { logoR2Key: _omit, ...rest } = r;
      return { ...rest, logoUrl };
    })
  );

  return NextResponse.json(enriched);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const workspace = await getCurrentWorkspace(session.user.id);
  if (!workspace) return NextResponse.json({ error: "No studio" }, { status: 400 });

  const ctx = await loadRoleContext(session.user.id, workspace.id);
  if (!canCreateBrand(ctx)) {
    return NextResponse.json({ error: "Only studio admins can create brands" }, { status: 403 });
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
        { error: "A brand with that name or slug already exists in this studio" },
        { status: 409 }
      );
    }
    throw error;
  }
}
