import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brews } from "@/lib/db/schema";
import { eq, and, sql, inArray, or } from "drizzle-orm";
import { isVideoModel } from "@/providers/registry";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const { id } = await params;

  // Source brew must be public/unlisted or owned by the user
  const [source] = await db
    .select()
    .from(brews)
    .where(
      and(
        eq(brews.id, id),
        or(
          inArray(brews.visibility, ["public", "unlisted"]),
          eq(brews.userId, userId)
        )
      )
    );

  if (!source) {
    return NextResponse.json({ error: "Brew not found" }, { status: 404 });
  }

  if (isVideoModel(source.model)) {
    return NextResponse.json(
      { error: "Video brews cannot be cloned" },
      { status: 400 }
    );
  }

  const [cloned] = await db
    .insert(brews)
    .values({
      userId,
      name: source.name,
      description: source.description,
      model: source.model,
      prompt: source.prompt,
      enhancedPrompt: source.enhancedPrompt,
      parameters: source.parameters,
      previewUrl: source.previewUrl,
      imageInput: source.imageInput,
      brandId: null,
      visibility: "private",
      slug: null,
      originalBrewId: source.id,
      originalUserId: source.userId,
    })
    .returning();

  // Increment usage count on source brew
  await db
    .update(brews)
    .set({ usageCount: sql`${brews.usageCount} + 1`, updatedAt: new Date() })
    .where(eq(brews.id, id));

  return NextResponse.json({ brew: cloned }, { status: 201 });
}
