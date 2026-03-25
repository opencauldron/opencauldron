import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  users,
  userBadges,
  badges,
  generations,
  assets,
} from "@/lib/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { getUserXP, getLevelProgress } from "@/lib/xp";
import { getAssetUrl } from "@/lib/storage";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await params;

  // Get viewer's role
  const [viewer] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const isOwnProfile = session.user.id === userId;
  const isAdmin = viewer?.role === "admin";

  // Get target user info
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      hasVideoAccess: users.hasVideoAccess,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Get badges earned
  const earnedBadges = await db
    .select({
      badgeId: badges.id,
      name: badges.name,
      description: badges.description,
      icon: badges.icon,
      category: badges.category,
      xpReward: badges.xpReward,
      earnedAt: userBadges.earnedAt,
    })
    .from(userBadges)
    .innerJoin(badges, eq(userBadges.badgeId, badges.id))
    .where(eq(userBadges.userId, userId))
    .orderBy(desc(userBadges.earnedAt));

  // Get generation stats
  const [stats] = await db
    .select({
      totalGenerations: sql<number>`count(*)::int`,
      favoriteModel: sql<string>`(
        select model from generations
        where user_id = ${userId} and status = 'completed'
        group by model
        order by count(*) desc
        limit 1
      )`,
    })
    .from(generations)
    .where(
      and(eq(generations.userId, userId), eq(generations.status, "completed"))
    );

  // Calculate streak
  const recentDays = await db
    .select({
      day: sql<string>`date(${generations.createdAt})`,
    })
    .from(generations)
    .where(
      and(eq(generations.userId, userId), eq(generations.status, "completed"))
    )
    .groupBy(sql`date(${generations.createdAt})`)
    .orderBy(sql`date(${generations.createdAt}) desc`)
    .limit(60);

  let streak = 0;
  if (recentDays.length > 0) {
    streak = 1;
    const today = new Date().toISOString().split("T")[0];
    const firstDay = recentDays[0].day;

    if (firstDay !== today) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      if (firstDay !== yesterday.toISOString().split("T")[0]) {
        streak = 0;
      }
    }

    if (streak > 0) {
      for (let i = 1; i < recentDays.length; i++) {
        const prev = new Date(recentDays[i - 1].day);
        const curr = new Date(recentDays[i].day);
        const diffDays =
          (prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays === 1) {
          streak++;
        } else {
          break;
        }
      }
    }
  }

  // Get recent assets (last 20)
  const recentAssetsRaw = await db
    .select({
      id: assets.id,
      mediaType: assets.mediaType,
      model: assets.model,
      prompt: assets.prompt,
      r2Key: assets.r2Key,
      thumbnailR2Key: assets.thumbnailR2Key,
      width: assets.width,
      height: assets.height,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .where(eq(assets.userId, userId))
    .orderBy(desc(assets.createdAt))
    .limit(20);

  const recentAssets = await Promise.all(
    recentAssetsRaw.map(async (a) => ({
      id: a.id,
      mediaType: a.mediaType,
      model: a.model,
      prompt: a.prompt,
      url: await getAssetUrl(a.r2Key),
      thumbnailUrl: a.thumbnailR2Key ? await getAssetUrl(a.thumbnailR2Key) : await getAssetUrl(a.r2Key),
      width: a.width,
      height: a.height,
      createdAt: a.createdAt,
    }))
  );

  // Build response
  const response: Record<string, unknown> = {
    user: {
      id: user.id,
      name: user.name,
      image: user.image,
      hasVideoAccess: user.hasVideoAccess,
      createdAt: user.createdAt,
    },
    badges: earnedBadges,
    stats: {
      totalGenerations: stats.totalGenerations,
      favoriteModel: stats.favoriteModel,
      streak,
    },
    recentAssets,
  };

  // XP details
  const xpRecord = await getUserXP(userId);
  response.xp = getLevelProgress(xpRecord.xp);

  return NextResponse.json(response);
}
