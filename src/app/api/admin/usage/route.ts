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

  // Check admin role
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);

  // Team today
  const [todayStats] = await db
    .select({
      count: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(cost_estimate), 0)::float`,
    })
    .from(generations)
    .where(
      and(gte(generations.createdAt, today), eq(generations.status, "completed"))
    );

  // Team month
  const [monthStats] = await db
    .select({
      count: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(cost_estimate), 0)::float`,
    })
    .from(generations)
    .where(
      and(
        gte(generations.createdAt, monthAgo),
        eq(generations.status, "completed")
      )
    );

  // By model (month)
  const byModel = await db
    .select({
      model: generations.model,
      count: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(cost_estimate), 0)::float`,
    })
    .from(generations)
    .where(
      and(
        gte(generations.createdAt, monthAgo),
        eq(generations.status, "completed")
      )
    )
    .groupBy(generations.model);

  // By user (month)
  const byUser = await db
    .select({
      userId: generations.userId,
      userName: users.name,
      userEmail: users.email,
      count: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(${generations.costEstimate}), 0)::float`,
    })
    .from(generations)
    .innerJoin(users, eq(generations.userId, users.id))
    .where(
      and(
        gte(generations.createdAt, monthAgo),
        eq(generations.status, "completed")
      )
    )
    .groupBy(generations.userId, users.name, users.email)
    .orderBy(sql`count(*) desc`);

  return NextResponse.json({
    today: todayStats,
    month: monthStats,
    byModel,
    byUser,
  });
}
