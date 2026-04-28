import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brandMembers, users } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  canInviteToBrand,
  canRemoveFromBrand,
  countBrandManagers,
  loadBrandContext,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { addWorkspaceMember } from "@/lib/workspace/bootstrap";

const inviteSchema = z.object({
  email: z.string().email().optional(),
  userId: z.string().uuid().optional(),
  role: z.enum(["brand_manager", "creator", "viewer"]).default("creator"),
}).refine((d) => !!d.email || !!d.userId, { message: "email or userId required" });

const patchSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["brand_manager", "creator", "viewer"]),
});

const removeSchema = z.object({ userId: z.string().uuid() });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const brand = await loadBrandContext(id);
  if (!brand) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await loadRoleContext(session.user.id, brand.workspaceId);
  if (!ctx.workspace) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db
    .select({
      userId: brandMembers.userId,
      role: brandMembers.role,
      email: users.email,
      name: users.name,
      image: users.image,
    })
    .from(brandMembers)
    .innerJoin(users, eq(users.id, brandMembers.userId))
    .where(eq(brandMembers.brandId, id));
  return NextResponse.json(rows);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const brand = await loadBrandContext(id);
  if (!brand) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await loadRoleContext(session.user.id, brand.workspaceId);
  if (!canInviteToBrand(ctx, brand)) {
    return NextResponse.json({ error: "not_brand_manager" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  let targetId = parsed.data.userId;
  if (!targetId && parsed.data.email) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email)).limit(1);
    if (existing) {
      targetId = existing.id;
    } else {
      const [created] = await db.insert(users).values({ email: parsed.data.email }).returning({ id: users.id });
      targetId = created.id;
    }
  }
  if (!targetId) return NextResponse.json({ error: "No target user" }, { status: 400 });

  // Ensure they're in the workspace (creates Personal brand too).
  await addWorkspaceMember({ workspaceId: brand.workspaceId, userId: targetId, role: "member" });

  await db
    .insert(brandMembers)
    .values({ brandId: id, userId: targetId, role: parsed.data.role })
    .onConflictDoNothing();

  return NextResponse.json({ brandId: id, userId: targetId, role: parsed.data.role }, { status: 201 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const brand = await loadBrandContext(id);
  if (!brand) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await loadRoleContext(session.user.id, brand.workspaceId);
  if (!canInviteToBrand(ctx, brand)) {
    return NextResponse.json({ error: "not_brand_manager" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Last-brand-manager guard — refuse to downgrade if doing so leaves zero.
  const [current] = await db
    .select({ role: brandMembers.role })
    .from(brandMembers)
    .where(and(eq(brandMembers.brandId, id), eq(brandMembers.userId, parsed.data.userId)))
    .limit(1);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (current.role === "brand_manager" && parsed.data.role !== "brand_manager") {
    const cnt = await countBrandManagers(id);
    if (cnt <= 1) {
      return NextResponse.json({ error: "last_brand_manager" }, { status: 409 });
    }
  }

  const [updated] = await db
    .update(brandMembers)
    .set({ role: parsed.data.role })
    .where(and(eq(brandMembers.brandId, id), eq(brandMembers.userId, parsed.data.userId)))
    .returning();
  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const brand = await loadBrandContext(id);
  if (!brand) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await loadRoleContext(session.user.id, brand.workspaceId);
  if (!canInviteToBrand(ctx, brand)) {
    return NextResponse.json({ error: "not_brand_manager" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = removeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const [current] = await db
    .select({ role: brandMembers.role })
    .from(brandMembers)
    .where(and(eq(brandMembers.brandId, id), eq(brandMembers.userId, parsed.data.userId)))
    .limit(1);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const cnt = await countBrandManagers(id);
  const guard = canRemoveFromBrand(
    ctx,
    brand,
    { userId: parsed.data.userId, role: current.role as "brand_manager" | "creator" | "viewer" },
    cnt
  );
  if (!guard.allowed) {
    return NextResponse.json({ error: guard.code ?? "forbidden" }, { status: guard.code === "last_brand_manager" ? 409 : 403 });
  }

  await db
    .delete(brandMembers)
    .where(and(eq(brandMembers.brandId, id), eq(brandMembers.userId, parsed.data.userId)));
  return NextResponse.json({ success: true });
}
