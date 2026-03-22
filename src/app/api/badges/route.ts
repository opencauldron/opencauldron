import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { badges, userBadges } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Get all badge definitions with the current user's earned status
  const allBadges = await db
    .select({
      id: badges.id,
      name: badges.name,
      description: badges.description,
      icon: badges.icon,
      category: badges.category,
      xpReward: badges.xpReward,
      sortOrder: badges.sortOrder,
      earnedAt: sql<string | null>`${userBadges.earnedAt}`,
    })
    .from(badges)
    .leftJoin(
      userBadges,
      sql`${userBadges.badgeId} = ${badges.id} and ${userBadges.userId} = ${userId}`
    )
    .orderBy(badges.sortOrder);

  return NextResponse.json({
    badges: allBadges.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      icon: b.icon,
      category: b.category,
      xpReward: b.xpReward,
      sortOrder: b.sortOrder,
      earned: b.earnedAt !== null,
      earnedAt: b.earnedAt,
    })),
  });
}
