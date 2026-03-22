import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, badges } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { adminGrantBadge } from "@/lib/xp";
import { z } from "zod";

const grantSchema = z.object({
  userId: z.string().uuid(),
  badgeId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check admin role from DB
  const [currentUser] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (currentUser?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = grantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { userId, badgeId } = parsed.data;

  // Verify target user exists
  const [targetUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Verify badge exists
  const [badge] = await db
    .select()
    .from(badges)
    .where(eq(badges.id, badgeId))
    .limit(1);

  if (!badge) {
    return NextResponse.json({ error: "Badge not found" }, { status: 404 });
  }

  const result = await adminGrantBadge(userId, badgeId);

  return NextResponse.json({
    success: true,
    badge: result,
  });
}
