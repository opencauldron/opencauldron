/**
 * Helpers for the user's Personal brand. Lazy-creates if missing — covers
 * legacy users whose Personal brand row was never bootstrapped + dev/test
 * databases that bypass the NextAuth signup hook.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { getCurrentWorkspace } from "./context";
import { bootstrapHostedSignup } from "./bootstrap";

export async function resolvePersonalBrandId(
  userId: string,
  workspaceId?: string
): Promise<string | null> {
  let wsId = workspaceId;
  if (!wsId) {
    const ws = await getCurrentWorkspace(userId);
    if (!ws) return null;
    wsId = ws.id;
  }

  const [existing] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(
      and(
        eq(brands.workspaceId, wsId),
        eq(brands.isPersonal, true),
        eq(brands.ownerId, userId)
      )
    )
    .limit(1);
  if (existing) return existing.id;

  // Lazy-create — workspace bootstrap covers the rest of the user setup too.
  const result = await bootstrapHostedSignup({ userId });
  return result.personalBrandId;
}
