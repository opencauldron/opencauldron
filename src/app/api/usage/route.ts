import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { generations, users } from "@/lib/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);

  // Get user's daily limit
  const [user] = await db
    .select({ dailyLimit: users.dailyLimit })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // Today's stats
  const [todayStats] = await db
    .select({
      count: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(cost_estimate), 0)::float`,
    })
    .from(generations)
    .where(
      and(
        eq(generations.userId, userId),
        gte(generations.createdAt, today),
        eq(generations.status, "completed")
      )
    );

  // This week's stats
  const [weekStats] = await db
    .select({
      count: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(cost_estimate), 0)::float`,
    })
    .from(generations)
    .where(
      and(
        eq(generations.userId, userId),
        gte(generations.createdAt, weekAgo),
        eq(generations.status, "completed")
      )
    );

  // This month's stats
  const [monthStats] = await db
    .select({
      count: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(cost_estimate), 0)::float`,
    })
    .from(generations)
    .where(
      and(
        eq(generations.userId, userId),
        gte(generations.createdAt, monthAgo),
        eq(generations.status, "completed")
      )
    );

  // By model breakdown (this month)
  const byModel = await db
    .select({
      model: generations.model,
      count: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(cost_estimate), 0)::float`,
    })
    .from(generations)
    .where(
      and(
        eq(generations.userId, userId),
        gte(generations.createdAt, monthAgo),
        eq(generations.status, "completed")
      )
    )
    .groupBy(generations.model);

  // Recent generations (last 20)
  const recent = await db
    .select({
      id: generations.id,
      model: generations.model,
      prompt: generations.prompt,
      status: generations.status,
      costEstimate: generations.costEstimate,
      durationMs: generations.durationMs,
      createdAt: generations.createdAt,
    })
    .from(generations)
    .where(eq(generations.userId, userId))
    .orderBy(sql`${generations.createdAt} desc`)
    .limit(20);

  return NextResponse.json({
    dailyLimit: user?.dailyLimit ?? 50,
    today: todayStats,
    week: weekStats,
    month: monthStats,
    byModel,
    recent,
  });
}
