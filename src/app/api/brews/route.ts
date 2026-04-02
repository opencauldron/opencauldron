import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brews, users } from "@/lib/db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { refreshUrl } from "@/lib/storage";

const createBrewSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  model: z.string().min(1, "Model is required"),
  prompt: z.string().optional(),
  enhancedPrompt: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  previewUrl: z.string().url().optional(),
  imageInput: z.array(z.string().url()).max(4).optional(),
  brandId: z.string().uuid().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const result = await db
    .select()
    .from(brews)
    .where(eq(brews.userId, userId))
    .orderBy(desc(brews.updatedAt));

  // Resolve original author names for cloned brews
  const originalUserIds = [
    ...new Set(result.filter((b) => b.originalUserId).map((b) => b.originalUserId!)),
  ];

  let authorMap: Record<string, string> = {};
  if (originalUserIds.length > 0) {
    const authors = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, originalUserIds));
    authorMap = Object.fromEntries(
      authors.map((a) => [a.id, a.name ?? "Unknown"])
    );
  }

  const brewsWithAttribution = await Promise.all(
    result.map(async (b) => ({
      ...b,
      previewUrl: b.previewUrl ? (await refreshUrl(b.previewUrl)) ?? b.previewUrl : null,
      originalAuthorName: b.originalUserId ? authorMap[b.originalUserId] ?? null : null,
    }))
  );

  return NextResponse.json({ brews: brewsWithAttribution });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const body = await req.json();
  const parsed = createBrewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const [brew] = await db
    .insert(brews)
    .values({
      userId,
      name: parsed.data.name,
      description: parsed.data.description,
      model: parsed.data.model,
      prompt: parsed.data.prompt,
      enhancedPrompt: parsed.data.enhancedPrompt,
      parameters: parsed.data.parameters,
      previewUrl: parsed.data.previewUrl,
      imageInput: parsed.data.imageInput,
      brandId: parsed.data.brandId,
    })
    .returning();

  return NextResponse.json({ brew }, { status: 201 });
}
