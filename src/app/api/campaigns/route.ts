/**
 * GET /api/campaigns?brandId=<id>  — list campaigns for a brand.
 * POST /api/campaigns                — create a new campaign on a brand.
 *
 * Read access mirrors brand-membership (any role); create gated by
 * `permissions.isBrandManager` (or workspace admin/owner).
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
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

const createSchema = z.object({
  brandId: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const brandId = new URL(req.url).searchParams.get("brandId");
  if (!brandId) {
    return NextResponse.json({ error: "brandId_required" }, { status: 400 });
  }

  const brandCtx = await loadBrandContext(brandId);
  if (!brandCtx) {
    return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
  }
  const ctx = await loadRoleContext(session.user.id, brandCtx.workspaceId);
  if (!isBrandMember(ctx, brandId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await db
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
    .where(eq(campaigns.brandId, brandId))
    .orderBy(asc(campaigns.name));

  return NextResponse.json({ campaigns: rows });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const brandCtx = await loadBrandContext(parsed.data.brandId);
  if (!brandCtx) {
    return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
  }
  const ctx = await loadRoleContext(session.user.id, brandCtx.workspaceId);
  if (!isBrandManager(ctx, parsed.data.brandId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const [row] = await db
      .insert(campaigns)
      .values({
        brandId: parsed.data.brandId,
        name: parsed.data.name,
        description: parsed.data.description,
        startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null,
        endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null,
        createdBy: session.user.id,
      })
      .returning();

    return NextResponse.json({ campaign: row }, { status: 201 });
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

