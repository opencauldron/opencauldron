import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brands, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  isBrandManager,
  loadBrandContext,
  loadRoleContext,
  canEditBrandKit,
} from "@/lib/workspace/permissions";
import { executeBrandDeletion } from "@/lib/workspace/brand-delete";
import { getAssetUrl } from "@/lib/storage";

const HEX = /^#[0-9a-fA-F]{6}$/;

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/).optional(),
  color: z.string().regex(HEX).optional(),
  promptPrefix: z.string().max(500).nullable().optional(),
  promptSuffix: z.string().max(500).nullable().optional(),
  bannedTerms: z.array(z.string().min(1).max(64)).max(64).optional(),
  defaultLoraId: z.string().nullable().optional(),
  defaultLoraIds: z.array(z.string()).max(16).optional(),
  // Renamed from `anchorReferenceIds` in the Library/DAM unification (0016).
  // The frontend's brand-kit editor switches over in Phase 3; for now both
  // names are accepted on PATCH so an in-flight UI deploy doesn't lose data.
  anchorAssetIds: z.array(z.string().uuid()).max(16).optional(),
  anchorReferenceIds: z.array(z.string().uuid()).max(16).optional(),
  palette: z.array(z.string().regex(HEX)).max(16).optional(),
  selfApprovalAllowed: z.boolean().optional(),
  videoEnabled: z.boolean().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [row] = await db
    .select({ brand: brands, ownerImage: users.image })
    .from(brands)
    .leftJoin(users, eq(users.id, brands.ownerId))
    .where(eq(brands.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { brand, ownerImage } = row;

  if (!brand.workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await loadRoleContext(session.user.id, brand.workspaceId);
  if (!ctx.workspace) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const logoUrl = brand.logoR2Key ? await getAssetUrl(brand.logoR2Key) : null;
  return NextResponse.json({ ...brand, logoUrl, ownerImage });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const brandCtx = await loadBrandContext(id);
  if (!brandCtx) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await loadRoleContext(session.user.id, brandCtx.workspaceId);
  if (!canEditBrandKit(ctx, brandCtx)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Compat shim: accept the legacy `anchorReferenceIds` name and fold it into
  // the new `anchorAssetIds` column. Explicit `anchorAssetIds` wins if both
  // are present. Removed once the Phase 3 UI lands and the legacy name dies.
  const { anchorReferenceIds: legacyAnchors, ...rest } = parsed.data;
  const updateValues: typeof rest & { anchorAssetIds?: string[] } = { ...rest };
  if (legacyAnchors !== undefined && updateValues.anchorAssetIds === undefined) {
    updateValues.anchorAssetIds = legacyAnchors;
  }

  try {
    const [updated] = await db
      .update(brands)
      .set(updateValues)
      .where(eq(brands.id, id))
      .returning();
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message.includes("unique")) {
      return NextResponse.json(
        { error: "Name or slug collision in this studio" },
        { status: 409 }
      );
    }
    throw error;
  }
}

const deleteSchema = z.object({
  assetAction: z.enum(["reassign", "delete"]),
  reassignBrandId: z.string().uuid().optional(),
});

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const brandCtx = await loadBrandContext(id);
  if (!brandCtx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Must be a member of the workspace at all — anything else is a 404 (we
  // don't leak workspace existence to outsiders).
  const ctx = await loadRoleContext(session.user.id, brandCtx.workspaceId);
  if (!ctx.workspace) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Permission: brand_manager on the brand (workspace admin/owner inherit).
  if (!isBrandManager(ctx, brandCtx.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Personal brands are never deletable from this endpoint — they're
  // system-managed alongside workspace membership.
  if (brandCtx.isPersonal) {
    return NextResponse.json(
      { error: "personal_brand_undeletable" },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await executeBrandDeletion({
    brandId: id,
    actorId: session.user.id,
    assetAction: parsed.data.assetAction,
    reassignBrandId: parsed.data.reassignBrandId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    assetCount: result.assetCount,
    brewCount: result.brewCount,
  });
}
