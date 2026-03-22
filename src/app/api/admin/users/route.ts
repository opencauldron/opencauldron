import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, generations } from "@/lib/db/schema";
import { eq, sql, gte, and } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check admin
  const [currentUser] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (currentUser?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);

  const allUsers = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      role: users.role,
      dailyLimit: users.dailyLimit,
      createdAt: users.createdAt,
      monthlyGenerations: sql<number>`(
        select count(*)::int from generations
        where generations.user_id = ${users.id}
        and generations.created_at >= ${monthAgo}
        and generations.status = 'completed'
      )`,
      monthlyCost: sql<number>`(
        select coalesce(sum(cost_estimate), 0)::float from generations
        where generations.user_id = ${users.id}
        and generations.created_at >= ${monthAgo}
        and generations.status = 'completed'
      )`,
    })
    .from(users)
    .orderBy(users.createdAt);

  return NextResponse.json({ users: allUsers });
}
