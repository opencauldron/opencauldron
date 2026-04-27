import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brands, workspaceMembers } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  loadBrandContext,
  loadRoleContext,
  canEditBrandKit,
  canDeleteBrand,
} from "@/lib/workspace/permissions";

const HEX = /^#[0-9a-fA-F]{6}$/;

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/).optional(),
  color: z.string().regex(HEX).optional(),
  promptPrefix: z.string().max(500).nullable().optional(),
  promptSuffix: z.string().max(500).nullable().optional(),
  bannedTerms: z.array(z.string().min(1).max(64)).max(64).optional(),
  defaultLoraId: z.string().nullable().optional(),
  defaultLoraIds: z.array(z.string()).max(16).optional(),
  anchorReferenceIds: z.array(z.string().uuid()).max(16).optional(),
  palette: z.array(z.string().regex(HEX)).max(16).optional(),
  selfApprovalAllowed: z.boolean().optional(),
  videoEnabled: z.boolean().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [brand] = await db.select().from(brands).where(eq(brands.id, id)).limit(1);
  if (!brand) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!brand.workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await loadRoleContext(session.user.id, brand.workspaceId);
  if (!ctx.workspace) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(brand);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const brandCtx = await loadBrandContext(id);
  if (!brandCtx) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await loadRoleContext(session.user.id, brandCtx.workspaceId);
  if (!canEditBrandKit(ctx, brandCtx)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const [updated] = await db
      .update(brands)
      .set(parsed.data)
      .where(eq(brands.id, id))
      .returning();
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message.includes("unique")) {
      return NextResponse.json(
        { error: "Name or slug collision in this workspace" },
        { status: 409 }
      );
    }
    throw error;
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const brandCtx = await loadBrandContext(id);
  if (!brandCtx) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let ownerStillMember = false;
  if (brandCtx.isPersonal && brandCtx.ownerId) {
    const rows = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, brandCtx.workspaceId),
          eq(workspaceMembers.userId, brandCtx.ownerId)
        )
      );
    ownerStillMember = (rows[0]?.cnt ?? 0) > 0;
  }

  const ctx = await loadRoleContext(session.user.id, brandCtx.workspaceId);
  if (!canDeleteBrand(ctx, brandCtx, ownerStillMember)) {
    if (brandCtx.isPersonal && ownerStillMember) {
      return NextResponse.json(
        { error: "personal_brand_undeletable" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.delete(brands).where(eq(brands.id, id));
  return NextResponse.json({ success: true });
}
