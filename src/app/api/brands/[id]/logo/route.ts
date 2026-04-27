import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  uploadFile,
  deleteFile,
  getAssetUrl,
} from "@/lib/storage";
import {
  isBrandManager,
  loadBrandContext,
  loadRoleContext,
} from "@/lib/workspace/permissions";

const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Auth + permission gate shared by POST and DELETE. Returns the loaded brand
 * + workspace context on success, or a NextResponse error on denial.
 */
async function authorize(brandId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const brand = await loadBrandContext(brandId);
  if (!brand) {
    return { error: NextResponse.json({ error: "brand_not_found" }, { status: 404 }) };
  }

  const ctx = await loadRoleContext(session.user.id, brand.workspaceId);

  // Personal-brand owner is implicitly a manager of their own brand even
  // without an explicit brand_members row.
  const isPersonalOwner =
    brand.isPersonal && brand.ownerId === session.user.id;

  if (!isPersonalOwner && !isBrandManager(ctx, brand.id)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  return { brandId: brand.id };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const guard = await authorize(id);
  if ("error" in guard) return guard.error;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }

  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "unsupported_type", allowed: Object.keys(ALLOWED_TYPES) },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "file_too_large", maxBytes: MAX_BYTES },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const key = `brands/${id}/logo-${nanoid(10)}.${ext}`;
  await uploadFile(buffer, key, file.type);

  // Best-effort delete of the previous logo. We do this AFTER the new upload
  // succeeds so a failed delete doesn't leave the brand with no logo at all.
  const [prev] = await db
    .select({ logoR2Key: brands.logoR2Key })
    .from(brands)
    .where(eq(brands.id, id))
    .limit(1);

  await db.update(brands).set({ logoR2Key: key }).where(eq(brands.id, id));

  if (prev?.logoR2Key && prev.logoR2Key !== key) {
    deleteFile(prev.logoR2Key).catch((err) => {
      console.error("[brands/logo] failed to delete previous logo", err);
    });
  }

  const logoUrl = await getAssetUrl(key);
  return NextResponse.json({ logoUrl });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const guard = await authorize(id);
  if ("error" in guard) return guard.error;

  const [prev] = await db
    .select({ logoR2Key: brands.logoR2Key })
    .from(brands)
    .where(eq(brands.id, id))
    .limit(1);

  if (!prev?.logoR2Key) {
    return new NextResponse(null, { status: 204 });
  }

  await db.update(brands).set({ logoR2Key: null }).where(eq(brands.id, id));
  deleteFile(prev.logoR2Key).catch((err) => {
    console.error("[brands/logo] failed to delete logo on remove", err);
  });

  return new NextResponse(null, { status: 204 });
}
