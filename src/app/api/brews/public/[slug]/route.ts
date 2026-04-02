import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { brews, users } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { refreshUrl } from "@/lib/storage";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const [row] = await db
    .select({
      id: brews.id,
      userId: brews.userId,
      name: brews.name,
      description: brews.description,
      model: brews.model,
      prompt: brews.prompt,
      enhancedPrompt: brews.enhancedPrompt,
      parameters: brews.parameters,
      previewUrl: brews.previewUrl,
      imageInput: brews.imageInput,
      brandId: brews.brandId,
      visibility: brews.visibility,
      slug: brews.slug,
      originalBrewId: brews.originalBrewId,
      originalUserId: brews.originalUserId,
      usageCount: brews.usageCount,
      createdAt: brews.createdAt,
      updatedAt: brews.updatedAt,
      authorName: users.name,
      authorImage: users.image,
    })
    .from(brews)
    .innerJoin(users, eq(brews.userId, users.id))
    .where(
      and(
        eq(brews.slug, slug),
        inArray(brews.visibility, ["public", "unlisted"])
      )
    );

  if (!row) {
    return NextResponse.json({ error: "Brew not found" }, { status: 404 });
  }

  const freshPreviewUrl = row.previewUrl
    ? (await refreshUrl(row.previewUrl)) ?? row.previewUrl
    : null;

  return NextResponse.json({ brew: { ...row, previewUrl: freshPreviewUrl } });
}
