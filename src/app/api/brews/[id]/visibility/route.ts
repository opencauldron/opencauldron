/**
 * POST /api/brews/[id]/visibility — three-level visibility transition (T155 / FR-042 / FR-043).
 *
 * Payload: `{ to: 'private' | 'brand' | 'public', note? }`. Permission gate
 * routes through `permissions.canChangeBrewVisibility`. On success: updates
 * `brews.visibility` AND writes one `brew_visibility_log` row.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brewVisibilityLog, brews } from "@/lib/db/schema";
import {
  canChangeBrewVisibility,
  loadRoleContext,
  type BrewVisibility,
} from "@/lib/workspace/permissions";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { generateBrewSlug } from "@/lib/slug";

const bodySchema = z.object({
  to: z.enum(["private", "brand", "public"]),
  note: z.string().max(500).optional(),
});

const VALID_FROM: ReadonlyArray<BrewVisibility> = ["private", "brand", "public"];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const to = parsed.data.to;
  const note = parsed.data.note ?? null;

  const [brew] = await db
    .select({
      id: brews.id,
      userId: brews.userId,
      brandId: brews.brandId,
      visibility: brews.visibility,
      slug: brews.slug,
      name: brews.name,
      previewUrl: brews.previewUrl,
    })
    .from(brews)
    .where(eq(brews.id, id))
    .limit(1);

  if (!brew) {
    return NextResponse.json({ error: "brew_not_found" }, { status: 404 });
  }

  // Treat the legacy `unlisted` value as `brand` for transition purposes —
  // 0009 backfills it but a fresh DB build may still have rows with the old
  // value during the transition window.
  const fromVis: BrewVisibility = (brew.visibility === "unlisted"
    ? "brand"
    : brew.visibility) as BrewVisibility;
  if (!VALID_FROM.includes(fromVis)) {
    return NextResponse.json(
      { error: "invalid_current_visibility" },
      { status: 500 }
    );
  }
  if (fromVis === to) {
    return NextResponse.json({ error: "noop_transition" }, { status: 409 });
  }

  // Workspace + role context. The brew may be brand-less (community recipe)
  // — fallback to the workspace owner heuristic in `canChangeBrewVisibility`.
  const workspace = await getCurrentWorkspace(userId);
  if (!workspace) {
    return NextResponse.json({ error: "no_workspace" }, { status: 403 });
  }
  const ctx = await loadRoleContext(userId, workspace.id);

  const allowed = canChangeBrewVisibility(
    ctx,
    { brandId: brew.brandId, userId: brew.userId },
    fromVis,
    to
  );
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // When promoting to `public` and the brew has no slug yet, mint one.
  const updates: Record<string, unknown> = {
    visibility: to,
    updatedAt: new Date(),
  };
  if (to === "public" && !brew.slug) {
    if (!brew.previewUrl) {
      return NextResponse.json(
        { error: "preview_required" },
        { status: 400 }
      );
    }
    updates.slug = generateBrewSlug(brew.name);
  }

  await db.update(brews).set(updates).where(eq(brews.id, id));

  await db.insert(brewVisibilityLog).values({
    brewId: id,
    actorId: userId,
    fromVisibility: fromVis,
    toVisibility: to,
    note,
  });

  return NextResponse.json({
    brew: {
      id,
      visibility: to,
      slug: (updates.slug as string | undefined) ?? brew.slug ?? null,
    },
  });
}
