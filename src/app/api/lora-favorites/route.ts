import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { loraFavorites } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

const favoriteSchema = z.object({
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
  const parsed = favoriteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const [favorite] = await db
      .insert(loraFavorites)
      .values({
        userId,
        civitaiModelId: parsed.data.civitaiModelId,
        civitaiVersionId: parsed.data.civitaiVersionId,
        name: parsed.data.name,
        downloadUrl: parsed.data.downloadUrl,
        triggerWords: parsed.data.triggerWords ?? [],
        previewImageUrl: parsed.data.previewImageUrl,
      })
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
