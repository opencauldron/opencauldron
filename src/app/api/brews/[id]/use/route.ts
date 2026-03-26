import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brews } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const { id } = await params;

  const [updated] = await db
    .update(brews)
    .set({
      usageCount: sql`${brews.usageCount} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(brews.id, id), eq(brews.userId, userId)))
    .returning({ id: brews.id });

  if (!updated) {
    return NextResponse.json({ error: "Brew not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
