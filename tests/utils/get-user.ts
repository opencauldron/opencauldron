import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

let cachedUserId: string | null = null;

export async function getUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;

  const [admin] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(1);

  if (admin) {
    cachedUserId = admin.id;
    console.log(`  Using admin user: ${admin.email} (${admin.id})`);
    return cachedUserId;
  }

  const [anyUser] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .limit(1);

  if (!anyUser) throw new Error("No users found in database");

  cachedUserId = anyUser.id;
  console.log(`  Using user: ${anyUser.email} (${anyUser.id})`);
  return cachedUserId;
}
