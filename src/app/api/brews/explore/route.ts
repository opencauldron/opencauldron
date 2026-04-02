import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { brews, users } from "@/lib/db/schema";
import { eq, desc, ilike, or, and, sql } from "drizzle-orm";
import { getAvailableProviders } from "@/providers/registry";
import { refreshUrl } from "@/lib/storage";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);
  const limit = Math.min(48, Math.max(1, parseInt(searchParams.get("limit") ?? "12", 10) || 12));
  const search = searchParams.get("search")?.trim() || null;
  const model = searchParams.get("model")?.trim() || null;
  const author = searchParams.get("author")?.trim() || null;
  const sort = searchParams.get("sort") === "popular" ? "popular" : "recent";

  // Get video model IDs to exclude
  const videoModelIds = getAvailableProviders("video").map((p) => p.id);

  const conditions = [eq(brews.visibility, "public")];

  if (videoModelIds.length > 0) {
    conditions.push(
      sql`${brews.model} NOT IN (${sql.join(
        videoModelIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    );
  }

  if (search) {
    conditions.push(
      or(
        ilike(brews.name, `%${search}%`),
        ilike(brews.description, `%${search}%`),
        ilike(brews.prompt, `%${search}%`)
      )!
    );
  }

  if (model) {
    conditions.push(eq(brews.model, model));
  }

  if (author) {
    conditions.push(eq(brews.userId, author));
  }

  const orderBy =
    sort === "popular"
      ? [desc(brews.usageCount), desc(brews.createdAt)]
      : [desc(brews.createdAt)];

  const rows = await db
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
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;

  const result = await Promise.all(
    trimmed.map(async (b) => ({
      ...b,
      previewUrl: b.previewUrl ? (await refreshUrl(b.previewUrl)) ?? b.previewUrl : null,
    }))
  );

  return NextResponse.json({ brews: result, hasMore });
}
