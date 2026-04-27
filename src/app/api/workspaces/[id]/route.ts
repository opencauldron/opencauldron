import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { loadRoleContext, isWorkspaceAdmin, isWorkspaceOwner } from "@/lib/workspace/permissions";

const patchSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    slug: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9-]+$/, "slug must be kebab-case")
      .optional(),
    logoUrl: z
      .string()
      .url()
      .max(2048)
      .nullable()
      .optional()
      .or(z.literal("").transform(() => null)),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const ctx = await loadRoleContext(session.user.id, id);
  if (!ctx.workspace) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
  if (!ws) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(ws);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const ctx = await loadRoleContext(session.user.id, id);
  if (!isWorkspaceAdmin(ctx)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const updates: Partial<{ name: string; slug: string; logoUrl: string | null }> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.slug !== undefined) updates.slug = parsed.data.slug;
  if (parsed.data.logoUrl !== undefined) updates.logoUrl = parsed.data.logoUrl;

  try {
    const [updated] = await db
      .update(workspaces)
      .set(updates)
      .where(eq(workspaces.id, id))
      .returning();
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("unique")) {
      return NextResponse.json(
        { error: "That slug is already taken." },
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
  const ctx = await loadRoleContext(session.user.id, id);
  if (!isWorkspaceOwner(ctx)) {
    return NextResponse.json({ error: "Only the studio owner can delete the studio" }, { status: 403 });
  }
  await db.delete(workspaces).where(eq(workspaces.id, id));
  return NextResponse.json({ success: true });
}
