import { db } from "@/lib/db";
import {
  userXp,
  xpTransactions,
  generations,
  userBadges,
  badges,
  users,
  assets,
  brands,
  workspaceMembers,
} from "@/lib/db/schema";
import { eq, and, sql, gte, isNotNull, desc } from "drizzle-orm";
import type { ModelId } from "@/types";
import { emitActivity } from "@/lib/activity";

/**
 * Resolve the workspace to attribute a workspace-scoped XP/badge event to.
 * Callers in a request context already have the workspace and SHOULD pass
 * it (cheaper, correct). When omitted we fall back to the user's
 * most-recently-created workspace_member row — matches the bell-feed scope
 * used elsewhere when no cookie is in scope.
 *
 * Returns `null` if the user has no workspace memberships at all (rare;
 * pre-bootstrap accounts only). Callers MUST swallow that case — emitting
 * a workspace-scoped activity row without a workspace_id would violate the
 * NOT NULL constraint and the spec.
 */
async function resolveActivityWorkspaceId(
  userId: string,
  workspaceId?: string
): Promise<string | null> {
  if (workspaceId) return workspaceId;
  const [row] = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(desc(workspaceMembers.createdAt))
    .limit(1);
  return row?.workspaceId ?? null;
}

// ============================================================
// XP Levels
// ============================================================

const LEVEL_THRESHOLDS = [0, 50, 150, 400, 800, 1500, 3000, 6000] as const;

const LEVEL_TITLES = [
  "Apprentice",   // Level 1
  "Herbalist",    // Level 2
  "Alchemist",    // Level 3 — video unlocks here
  "Enchanter",    // Level 4
  "Warlock",      // Level 5
  "Archmage",     // Level 6
  "Mythweaver",   // Level 7
  "Elder",        // Level 8
] as const;

export const VIDEO_UNLOCK_LEVEL = 3;

export function getLevelFromXP(xp: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

export function getLevelTitle(level: number): string {
  return LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length) - 1];
}

export function getXPForNextLevel(level: number): number | null {
  if (level >= LEVEL_THRESHOLDS.length) return null;
  return LEVEL_THRESHOLDS[level];
}

export function getLevelProgress(xp: number): {
  level: number;
  title: string;
  currentXP: number;
  nextLevelXP: number | null;
  progress: number; // 0-100
} {
  const level = getLevelFromXP(xp);
  const title = getLevelTitle(level);
  const nextLevelXP = getXPForNextLevel(level);
  const currentThreshold = LEVEL_THRESHOLDS[level - 1];

  let progress = 100;
  if (nextLevelXP !== null) {
    progress = Math.round(
      ((xp - currentThreshold) / (nextLevelXP - currentThreshold)) * 100
    );
  }

  return { level, title, currentXP: xp, nextLevelXP, progress };
}

// ============================================================
// XP rewards per model
// ============================================================

const IMAGE_XP_REWARDS: Partial<Record<ModelId, number>> = {
  "imagen-4": 10,
  "imagen-flash": 5,
  "imagen-flash-lite": 5,
  "ideogram-3": 10,
  "grok-imagine": 5,
  "grok-imagine-pro": 10,
  "flux-1.1-pro": 10,
  "flux-dev": 5,
  "recraft-v3": 10,
  "recraft-20b": 5,
};

export function getXPReward(
  modelId: ModelId,
  mediaType: "image" | "video",
  duration?: number
): number {
  if (mediaType === "video") {
    return (duration ?? 5) <= 5 ? 25 : 50;
  }
  return IMAGE_XP_REWARDS[modelId] ?? 5;
}

// ============================================================
// XP operations
// ============================================================

export async function getUserXP(userId: string) {
  let [record] = await db
    .select()
    .from(userXp)
    .where(eq(userXp.userId, userId))
    .limit(1);

  if (!record) {
    [record] = await db
      .insert(userXp)
      .values({ userId })
      .returning();
  }

  return record;
}

export async function awardXP(
  userId: string,
  amount: number,
  type: "generation" | "badge_reward" | "admin_grant",
  description: string,
  generationId?: string,
  workspaceId?: string
): Promise<{ newXP: number; newLevel: number; leveledUp: boolean }> {
  const record = await getUserXP(userId);
  const newXP = record.xp + amount;
  const newLevel = getLevelFromXP(newXP);
  const leveledUp = newLevel > record.level;

  await db
    .update(userXp)
    .set({ xp: newXP, level: newLevel })
    .where(eq(userXp.userId, userId));

  await db.insert(xpTransactions).values({
    userId,
    amount,
    type,
    description,
    generationId: generationId ?? null,
  });

  // Activity feed (US2 / FR-002). `member.leveled_up` is workspace-scoped:
  // every member sees their teammates climb the curve. Visibility is the
  // caller-passed `workspace`; brand_id stays null (level-ups aren't
  // brand-bound). If the user has no workspace_members row we silently skip
  // emission rather than raise — pre-bootstrap accounts are out of scope.
  if (leveledUp) {
    const wsId = await resolveActivityWorkspaceId(userId, workspaceId);
    if (wsId) {
      await emitActivity(db, {
        actorId: userId,
        verb: "member.leveled_up",
        objectType: "user",
        objectId: userId,
        workspaceId: wsId,
        brandId: null,
        visibility: "workspace",
        metadata: { level: newLevel, title: getLevelTitle(newLevel) },
      });
    }
  }

  return { newXP, newLevel, leveledUp };
}

export function hasVideoAccess(level: number): boolean {
  return level >= VIDEO_UNLOCK_LEVEL;
}

// ============================================================
// Badge checking & awarding
// ============================================================

interface BadgeCheckResult {
  badgeId: string;
  name: string;
  icon: string;
  xpReward: number;
}

export async function checkAndAwardBadges(
  userId: string,
  workspaceId?: string
): Promise<BadgeCheckResult[]> {
  const existingBadges = await db
    .select({ badgeId: userBadges.badgeId })
    .from(userBadges)
    .where(eq(userBadges.userId, userId));

  const earned = new Set(existingBadges.map((b) => b.badgeId));
  const newlyEarned: BadgeCheckResult[] = [];

  const [genStats] = await db
    .select({
      totalCount: sql<number>`count(*)::int`,
      distinctModels: sql<number>`count(distinct model)::int`,
      distinctImageModels: sql<number>`count(distinct case when model not in ('veo-3','runway-gen4-turbo','kling-2.1','hailuo-2.3','ray-2') then model end)::int`,
      videoCount: sql<number>`count(case when model in ('veo-3','runway-gen4-turbo','kling-2.1','hailuo-2.3','ray-2') then 1 end)::int`,
    })
    .from(generations)
    .where(
      and(eq(generations.userId, userId), eq(generations.status, "completed"))
    );

  // Milestones
  if (!earned.has("first-brew") && genStats.totalCount >= 1) {
    newlyEarned.push(await awardBadge(userId, "first-brew", workspaceId));
  }
  if (!earned.has("centaur") && genStats.totalCount >= 100) {
    newlyEarned.push(await awardBadge(userId, "centaur", workspaceId));
  }
  if (!earned.has("hydra") && genStats.totalCount >= 1000) {
    newlyEarned.push(await awardBadge(userId, "hydra", workspaceId));
  }

  // Model exploration
  if (!earned.has("ranger") && genStats.distinctImageModels >= 5) {
    newlyEarned.push(await awardBadge(userId, "ranger", workspaceId));
  }

  // Video
  if (!earned.has("illusionist") && genStats.videoCount >= 1) {
    newlyEarned.push(await awardBadge(userId, "illusionist", workspaceId));
  }
  if (!earned.has("conjurer") && genStats.videoCount >= 50) {
    newlyEarned.push(await awardBadge(userId, "conjurer", workspaceId));
  }

  // Streaks
  const streak = await calculateStreak(userId);
  if (!earned.has("kindling") && streak >= 7) {
    newlyEarned.push(await awardBadge(userId, "kindling", workspaceId));
  }
  if (!earned.has("inferno") && streak >= 30) {
    newlyEarned.push(await awardBadge(userId, "inferno", workspaceId));
  }

  // Brand tagging — assets attached to a non-Personal brand. The asset_brands
  // junction was dropped in migration 0010; brand membership is now the single
  // FK assets.brand_id.
  const [brandStats] = await db
    .select({
      taggedCount: sql<number>`count(*)::int`,
    })
    .from(assets)
    .innerJoin(brands, eq(assets.brandId, brands.id))
    .where(
      and(
        eq(assets.userId, userId),
        isNotNull(assets.brandId),
        eq(brands.isPersonal, false)
      )
    );

  if (!earned.has("sigil") && brandStats.taggedCount >= 50) {
    newlyEarned.push(await awardBadge(userId, "sigil", workspaceId));
  }

  return newlyEarned;
}

async function awardBadge(
  userId: string,
  badgeId: string,
  workspaceId?: string
): Promise<BadgeCheckResult> {
  const [badge] = await db
    .select()
    .from(badges)
    .where(eq(badges.id, badgeId))
    .limit(1);

  await db
    .insert(userBadges)
    .values({ userId, badgeId })
    .onConflictDoNothing();

  // Activity feed (US2 / FR-002). `member.earned_feat` is workspace-scoped:
  // every member sees their teammates' wins. Resolved workspace_id falls
  // back to the user's most-recently-created membership when the caller
  // didn't pass one (admin-grant + topup paths).
  const wsId = await resolveActivityWorkspaceId(userId, workspaceId);
  if (wsId) {
    await emitActivity(db, {
      actorId: userId,
      verb: "member.earned_feat",
      objectType: "feat",
      objectId: badge.id,
      workspaceId: wsId,
      brandId: null,
      visibility: "workspace",
      metadata: { feat: badge.id, name: badge.name, icon: badge.icon },
    });
  }

  if (badge.xpReward > 0) {
    // Propagate workspaceId so the recursive `awardXP` can attribute a
    // potential `member.leveled_up` to the same workspace.
    await awardXP(
      userId,
      badge.xpReward,
      "badge_reward",
      `Badge earned: ${badge.name} (+${badge.xpReward} XP)`,
      undefined,
      wsId ?? undefined
    );
  }

  return {
    badgeId: badge.id,
    name: badge.name,
    icon: badge.icon,
    xpReward: badge.xpReward,
  };
}

export async function adminGrantBadge(
  userId: string,
  badgeId: string,
  workspaceId?: string
): Promise<BadgeCheckResult> {
  return awardBadge(userId, badgeId, workspaceId);
}

async function calculateStreak(userId: string): Promise<number> {
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

  if (recentDays.length === 0) return 0;

  let streak = 1;
  const today = new Date().toISOString().split("T")[0];
  const firstDay = recentDays[0].day;

  if (firstDay !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (firstDay !== yesterday.toISOString().split("T")[0]) return 0;
  }

  for (let i = 1; i < recentDays.length; i++) {
    const prev = new Date(recentDays[i - 1].day);
    const curr = new Date(recentDays[i].day);
    const diffDays = (prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

export async function getLeaderboard() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const topGenerators = await db
    .select({
      userId: generations.userId,
      userName: users.name,
      userImage: users.image,
      count: sql<number>`count(*)::int`,
    })
    .from(generations)
    .innerJoin(users, eq(generations.userId, users.id))
    .where(
      and(
        gte(generations.createdAt, monthStart),
        eq(generations.status, "completed")
      )
    )
    .groupBy(generations.userId, users.name, users.image)
    .orderBy(sql`count(*) desc`)
    .limit(10);

  const mostBadges = await db
    .select({
      userId: userBadges.userId,
      userName: users.name,
      userImage: users.image,
      badgeCount: sql<number>`count(*)::int`,
    })
    .from(userBadges)
    .innerJoin(users, eq(userBadges.userId, users.id))
    .groupBy(userBadges.userId, users.name, users.image)
    .orderBy(sql`count(*) desc`)
    .limit(10);

  const highestXP = await db
    .select({
      userId: userXp.userId,
      userName: users.name,
      userImage: users.image,
      xp: userXp.xp,
      level: userXp.level,
    })
    .from(userXp)
    .innerJoin(users, eq(userXp.userId, users.id))
    .orderBy(sql`${userXp.xp} desc`)
    .limit(10);

  return { topGenerators, mostBadges, highestXP };
}
