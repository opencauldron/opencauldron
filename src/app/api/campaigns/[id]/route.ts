/**
 * GET    /api/campaigns/[id] — fetch a single campaign (brand member access).
 * PATCH  /api/campaigns/[id] — edit campaign metadata (brand_manager+).
 * DELETE /api/campaigns/[id] — delete a campaign (brand_manager+).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import {
  isBrandManager,
  isBrandMember,
  loadBrandContext,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { eq } from "drizzle-orm";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});

async function loadAndGate(
  campaignId: string,
  userId: string
): Promise<
  | { ok: true; brandId: string }
  | { ok: false; status: number; error: string }
> {
  const [row] = await db
    .select({ brandId: campaigns.brandId })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!row) return { ok: false, status: 404, error: "Not found" };

  const brandCtx = await loadBrandContext(row.brandId);
  if (!brandCtx) return { ok: false, status: 404, error: "Not found" };
  const ctx = await loadRoleContext(userId, brandCtx.workspaceId);
  if (!isBrandManager(ctx, row.brandId)) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, brandId: row.brandId };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const [row] = await db
    .select({
      id: campaigns.id,
      brandId: campaigns.brandId,
      name: campaigns.name,
      description: campaigns.description,
      startsAt: campaigns.startsAt,
      endsAt: campaigns.endsAt,
      createdBy: campaigns.createdBy,
      createdAt: campaigns.createdAt,
    })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const brandCtx = await loadBrandContext(row.brandId);
  if (!brandCtx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const ctx = await loadRoleContext(session.user.id, brandCtx.workspaceId);
  if (!isBrandMember(ctx, row.brandId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ campaign: row });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const gate = await loadAndGate(id, session.user.id);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { ...parsed.data };
  if ("startsAt" in updates) {
    updates.startsAt =
      typeof updates.startsAt === "string"
        ? new Date(updates.startsAt)
        : updates.startsAt;
  }
  if ("endsAt" in updates) {
    updates.endsAt =
      typeof updates.endsAt === "string"
        ? new Date(updates.endsAt)
        : updates.endsAt;
  }

  try {
    const [row] = await db
      .update(campaigns)
      .set(updates)
      .where(eq(campaigns.id, id))
      .returning();
    return NextResponse.json({ campaign: row });
  } catch (err) {
    if (err instanceof Error && err.message.includes("unique")) {
      return NextResponse.json(
        { error: "campaign_name_collision" },
        { status: 409 }
      );
    }
    throw err;
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
  const { id } = await params;
  const gate = await loadAndGate(id, session.user.id);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  await db.delete(campaigns).where(eq(campaigns.id, id));
  return NextResponse.json({ success: true });
}
