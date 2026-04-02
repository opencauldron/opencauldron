import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brews } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { generateBrewSlug } from "@/lib/slug";
import { isVideoModel } from "@/providers/registry";

const updateBrewSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  brandId: z.string().uuid().nullable().optional(),
  visibility: z.enum(["private", "unlisted", "public"]).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const { id } = await params;

  const body = await req.json();
  const parsed = updateBrewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const updates = parsed.data;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "Nothing to update" },
      { status: 400 }
    );
  }

  // If publishing, validate requirements
  if (updates.visibility === "unlisted" || updates.visibility === "public") {
    const [existing] = await db
      .select()
      .from(brews)
      .where(and(eq(brews.id, id), eq(brews.userId, userId)));

    if (!existing) {
      return NextResponse.json({ error: "Brew not found" }, { status: 404 });
    }

    if (!existing.previewUrl) {
      return NextResponse.json(
        { error: "A preview image is required to publish a brew" },
        { status: 400 }
      );
    }

    if (isVideoModel(existing.model)) {
      return NextResponse.json(
        { error: "Video brews cannot be published" },
        { status: 400 }
      );
    }

    // Generate slug if not already set
    if (!existing.slug) {
      const slug = generateBrewSlug(existing.name);
      (updates as Record<string, unknown>).slug = slug;
    }
  }

  // Retry loop for slug collision
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [brew] = await db
        .update(brews)
        .set({ ...updates, updatedAt: new Date() } as Record<string, unknown>)
        .where(and(eq(brews.id, id), eq(brews.userId, userId)))
        .returning();

      if (!brew) {
        return NextResponse.json({ error: "Brew not found" }, { status: 404 });
      }

      return NextResponse.json({ brew });
    } catch (err: unknown) {
      const isSlugCollision =
        err instanceof Error && err.message.includes("brews_slug_unique");
      if (isSlugCollision && attempt < 2) {
        // Regenerate slug and retry
        const [existing] = await db
          .select({ name: brews.name })
          .from(brews)
          .where(eq(brews.id, id));
        if (existing) {
          (updates as Record<string, unknown>).slug = generateBrewSlug(existing.name);
        }
        continue;
      }
      throw err;
    }
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const { id } = await params;

  const [deleted] = await db
    .delete(brews)
    .where(and(eq(brews.id, id), eq(brews.userId, userId)))
    .returning({ id: brews.id });

  if (!deleted) {
    return NextResponse.json({ error: "Brew not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
