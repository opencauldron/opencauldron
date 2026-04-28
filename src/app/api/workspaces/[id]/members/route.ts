import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, workspaceMembers } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { loadRoleContext, isWorkspaceAdmin, isWorkspaceOwner } from "@/lib/workspace/permissions";
import { addWorkspaceMember } from "@/lib/workspace/bootstrap";

const inviteSchema = z.object({
  email: z.string().email().optional(),
  userId: z.string().uuid().optional(),
  role: z.enum(["owner", "admin", "member"]).default("member"),
}).refine((d) => !!d.email || !!d.userId, { message: "email or userId required" });

const patchSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["owner", "admin", "member"]).optional(),
  canGenerateVideo: z.boolean().optional(),
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

  const rows = await db
    .select({
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      canGenerateVideo: workspaceMembers.canGenerateVideo,
      email: users.email,
      name: users.name,
      image: users.image,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, id));

  return NextResponse.json(rows);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: workspaceId } = await params;
  const ctx = await loadRoleContext(session.user.id, workspaceId);
  if (!isWorkspaceAdmin(ctx)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  // Only owners can mint another owner.
  if (parsed.data.role === "owner" && !isWorkspaceOwner(ctx)) {
    return NextResponse.json({ error: "Only an owner can grant owner role" }, { status: 403 });
  }

  await addWorkspaceMember({ workspaceId, userId: targetId, role: parsed.data.role });
  return NextResponse.json({ workspaceId, userId: targetId, role: parsed.data.role }, { status: 201 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: workspaceId } = await params;
  const ctx = await loadRoleContext(session.user.id, workspaceId);
  if (!isWorkspaceAdmin(ctx)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const update: Partial<{ role: "owner" | "admin" | "member"; canGenerateVideo: boolean }> = {};
  if (parsed.data.role) {
    if (parsed.data.role === "owner" && !isWorkspaceOwner(ctx)) {
      return NextResponse.json({ error: "Only an owner can grant owner role" }, { status: 403 });
    }
    update.role = parsed.data.role;
  }
  if (parsed.data.canGenerateVideo !== undefined) update.canGenerateVideo = parsed.data.canGenerateVideo;

  const [updated] = await db
    .update(workspaceMembers)
    .set(update)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, parsed.data.userId)))
    .returning();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}
