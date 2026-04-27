import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { loadRoleContext, isWorkspaceAdmin, isWorkspaceOwner } from "@/lib/workspace/permissions";

const patchSchema = z.object({ name: z.string().min(1).max(100) });

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
  const [updated] = await db
    .update(workspaces)
    .set({ name: parsed.data.name })
    .where(eq(workspaces.id, id))
    .returning();
  return NextResponse.json(updated);
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
    return NextResponse.json({ error: "Only the workspace owner can delete the workspace" }, { status: 403 });
  }
  await db.delete(workspaces).where(eq(workspaces.id, id));
  return NextResponse.json({ success: true });
}
