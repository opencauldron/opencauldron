import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { loraFavorites } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

const civitaiFavoriteSchema = z.object({
  source: z.literal("civitai"),
  civitaiModelId: z.number().int(),
  civitaiVersionId: z.number().int(),
  name: z.string().min(1),
  downloadUrl: z.string().url(),
  triggerWords: z.array(z.string()).optional(),
  previewImageUrl: z.string().url().optional(),
});

const huggingfaceFavoriteSchema = z.object({
  source: z.literal("huggingface"),
  hfRepoId: z.string().min(1),
  name: z.string().min(1),
  downloadUrl: z.string().url(),
  triggerWords: z.array(z.string()).optional(),
  previewImageUrl: z.string().url().optional(),
});

const favoriteSchema = z.discriminatedUnion("source", [
  civitaiFavoriteSchema,
  huggingfaceFavoriteSchema,
]);

// Legacy schema for backward compatibility (no source field)
const legacyFavoriteSchema = z.object({
  civitaiModelId: z.number().int(),
  civitaiVersionId: z.number().int(),
  name: z.string().min(1),
  downloadUrl: z.string().url(),
  triggerWords: z.array(z.string()).optional(),
  previewImageUrl: z.string().url().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const favorites = await db
    .select()
    .from(loraFavorites)
    .where(eq(loraFavorites.userId, userId))
    .orderBy(desc(loraFavorites.createdAt));

  return NextResponse.json({ favorites });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json();

  // Try new schema first, then fall back to legacy (no source field)
  let parsed = favoriteSchema.safeParse(body);
  if (!parsed.success) {
    const legacyParsed = legacyFavoriteSchema.safeParse(body);
    if (legacyParsed.success) {
      // Re-parse with source defaulted
      parsed = favoriteSchema.safeParse({ ...legacyParsed.data, source: "civitai" });
    }
  }

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const values: Record<string, unknown> = {
      userId,
      source: parsed.data.source,
      name: parsed.data.name,
      downloadUrl: parsed.data.downloadUrl,
      triggerWords: parsed.data.triggerWords ?? [],
      previewImageUrl: parsed.data.previewImageUrl,
    };
    if (parsed.data.source === "civitai") {
      values.civitaiModelId = parsed.data.civitaiModelId;
      values.civitaiVersionId = parsed.data.civitaiVersionId;
    } else {
      values.hfRepoId = parsed.data.hfRepoId;
    }

    const [favorite] = await db
      .insert(loraFavorites)
      .values(values as typeof loraFavorites.$inferInsert)
      .returning();

    return NextResponse.json({ favorite });
  } catch (error) {
    // Handle unique constraint violation (user already favorited this version)
    if (
      error instanceof Error &&
      error.message.includes("unique")
    ) {
      return NextResponse.json(
        { error: "Already favorited this LoRA version" },
        { status: 409 }
      );
    }
    throw error;
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { error: "Missing id parameter" },
      { status: 400 }
    );
  }

  await db
    .delete(loraFavorites)
    .where(and(eq(loraFavorites.id, id), eq(loraFavorites.userId, userId)));

  return NextResponse.json({ success: true });
}
