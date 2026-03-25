import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { badges } from "./schema";
import { eq } from "drizzle-orm";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle({ client: sql });

const badgeDefinitions = [
  // Milestones
  {
    id: "first-brew",
    name: "First Brew",
    description: "Generated your first creation",
    icon: "FlaskConical",
    category: "milestone" as const,
    xpReward: 10,
    sortOrder: 1,
  },
  {
    id: "centaur",
    name: "Centaur",
    description: "Generated 100 creations",
    icon: "Award",
    category: "milestone" as const,
    xpReward: 50,
    sortOrder: 2,
  },
  {
    id: "hydra",
    name: "Hydra",
    description: "Generated 1,000 creations",
    icon: "Trophy",
    category: "milestone" as const,
    xpReward: 100,
    sortOrder: 3,
  },
  // Streaks
  {
    id: "kindling",
    name: "Kindling",
    description: "7-day generation streak",
    icon: "Flame",
    category: "streak" as const,
    xpReward: 25,
    sortOrder: 10,
  },
  {
    id: "inferno",
    name: "Inferno",
    description: "30-day generation streak",
    icon: "Zap",
    category: "streak" as const,
    xpReward: 100,
    sortOrder: 11,
  },
  // Model
  {
    id: "ranger",
    name: "Ranger",
    description: "Used 5+ different image models",
    icon: "Compass",
    category: "model" as const,
    xpReward: 25,
    sortOrder: 20,
  },
  // Quality
  {
    id: "sigil",
    name: "Sigil",
    description: "Tagged 50+ assets with brands",
    icon: "Tags",
    category: "quality" as const,
    xpReward: 25,
    sortOrder: 30,
  },
  // Video
  {
    id: "illusionist",
    name: "Illusionist",
    description: "Generated your first video",
    icon: "Video",
    category: "video" as const,
    xpReward: 20,
    sortOrder: 40,
  },
  {
    id: "conjurer",
    name: "Conjurer",
    description: "Generated 50 videos",
    icon: "Film",
    category: "video" as const,
    xpReward: 50,
    sortOrder: 41,
  },
  // Special
  {
    id: "early-adopter",
    name: "Early Adopter",
    description: "Joined in the first month",
    icon: "Star",
    category: "special" as const,
    xpReward: 0,
    sortOrder: 50,
  },
  {
    id: "admin",
    name: "Admin",
    description: "Team administrator",
    icon: "Shield",
    category: "special" as const,
    xpReward: 0,
    sortOrder: 51,
  },
  {
    id: "founder",
    name: "Founder",
    description: "Studio creator and owner",
    icon: "Crown",
    category: "special" as const,
    xpReward: 0,
    sortOrder: 52,
  },
];

async function seed() {
  console.log("Seeding feats...");

  // Remove legacy badges that were renamed
  const validIds = badgeDefinitions.map((b) => b.id);
  const existing = await db.select({ id: badges.id }).from(badges);
  for (const row of existing) {
    if (!validIds.includes(row.id)) {
      console.log(`  Removing legacy badge: ${row.id}`);
      await db.delete(badges).where(eq(badges.id, row.id));
    }
  }

  for (const badge of badgeDefinitions) {
    await db
      .insert(badges)
      .values(badge)
      .onConflictDoUpdate({
        target: badges.id,
        set: {
          name: badge.name,
          description: badge.description,
          icon: badge.icon,
          category: badge.category,
          xpReward: badge.xpReward,
          sortOrder: badge.sortOrder,
        },
      });
  }

  console.log(`Seeded ${badgeDefinitions.length} feats`);
}

seed().catch(console.error);
