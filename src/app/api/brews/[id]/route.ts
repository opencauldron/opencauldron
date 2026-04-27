import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brews } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const updateBrewSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  brandId: z.string().uuid().nullable().optional(),
  // Visibility writes route through POST /api/brews/[id]/visibility (FR-042)
  // so the brew_visibility_log row is always written in the same step.
  // Accept the field on PATCH as a deprecated alias and forward callers there.
  visibility: z.enum(["private", "brand", "public"]).optional(),
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

  // Visibility changes belong on the dedicated /visibility endpoint (T155)
  // so the brew_visibility_log row is always written in the same step.
  if (updates.visibility) {
    return NextResponse.json(
      {
        error: "use_visibility_endpoint",
        endpoint: `/api/brews/${id}/visibility`,
      },
      { status: 400 }
    );
  }

  // Slug minting moved to /visibility — PATCH only handles non-visibility
  // metadata edits, so a single update statement is sufficient.
  const [brew] = await db
    .update(brews)
    .set({ ...updates, updatedAt: new Date() } as Record<string, unknown>)
    .where(and(eq(brews.id, id), eq(brews.userId, userId)))
    .returning();

  if (!brew) {
    return NextResponse.json({ error: "Brew not found" }, { status: 404 });
  }

  return NextResponse.json({ brew });
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
