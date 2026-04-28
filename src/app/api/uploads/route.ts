import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  uploadFile,
  generateAndUploadThumbnail,
  getAssetUrl,
} from "@/lib/storage";
import { db } from "@/lib/db";
import { assets, brands, references, uploads } from "@/lib/db/schema";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import {
  canCreateAsset,
  loadBrandContext,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";

// Reference path (legacy) — for image inputs in /generate. 10MB images only.
const REFERENCE_MAX_SIZE = 10 * 1024 * 1024;
const REFERENCE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

// Asset-upload validation contract lives in a sibling pure module so it can
// be unit-tested without dragging in this route's `next/server` + DB graph.
// Re-exported here for backward compatibility with any caller that imported
// from the route directly.
import {
  ASSET_MAX_SIZE,
  ASSET_IMAGE_TYPES,
  ASSET_VIDEO_TYPES,
  validateAssetUpload,
} from "./validation";
export {
  ASSET_MAX_SIZE,
  ASSET_IMAGE_TYPES,
  ASSET_VIDEO_TYPES,
  validateAssetUpload,
};
export type { AssetUploadValidation } from "./validation";

const EXT_MAP: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const brandIdHint = (formData.get("brandId") as string | null) ?? null;

  if (!file) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }

  // The presence of `brandId` is the discriminator: brand-scoped uploads land
  // in `assets` + `uploads`; the legacy reference path is unchanged.
  if (brandIdHint) {
    return handleAssetUpload(userId, file, brandIdHint);
  }
  return handleReferenceUpload(userId, file);
}

// ---------------------------------------------------------------------------
// Asset upload (US6 / T120)
// ---------------------------------------------------------------------------

async function handleAssetUpload(
  userId: string,
  file: File,
  brandIdHint: string
) {
  const validation = validateAssetUpload(file);
  if (!validation.ok) {
    const body: Record<string, unknown> = { error: validation.error };
    if (validation.allowed) body.allowed = validation.allowed;
    if (validation.maxBytes !== undefined) body.maxBytes = validation.maxBytes;
    return NextResponse.json(body, { status: validation.status });
  }
  const isImage = validation.mediaType === "image";

  const workspace = await getCurrentWorkspace(userId);
  if (!workspace) {
    return NextResponse.json({ error: "no_workspace" }, { status: 403 });
  }

  // Resolve brand. Personal sentinel: pick the user's Personal brand in this
  // workspace; explicit uuid: must belong to this workspace.
  let brandId: string;
  if (brandIdHint === "personal") {
    const [personal] = await db
      .select({ id: brands.id })
      .from(brands)
      .where(
        and(
          eq(brands.workspaceId, workspace.id),
          eq(brands.isPersonal, true),
          eq(brands.ownerId, userId)
        )
      )
      .limit(1);
    if (!personal) {
      return NextResponse.json({ error: "personal_brand_missing" }, { status: 404 });
    }
    brandId = personal.id;
  } else {
    const [b] = await db
      .select({ id: brands.id, workspaceId: brands.workspaceId })
      .from(brands)
      .where(eq(brands.id, brandIdHint))
      .limit(1);
    if (!b || b.workspaceId !== workspace.id) {
      return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
    }
    brandId = b.id;
  }

  const brandCtx = await loadBrandContext(brandId);
  if (!brandCtx) {
    return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
  }
  const ctx = await loadRoleContext(userId, workspace.id);

  // Personal-brand carve-out — the owner is implicitly a creator on their own
  // Personal brand even without an explicit `brand_members` row.
  if (brandCtx.isPersonal && brandCtx.ownerId === userId) {
    if (!ctx.brandMemberships.has(brandId)) {
      ctx.brandMemberships.set(brandId, "creator");
    }
  }

  if (!canCreateAsset(ctx, brandCtx)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = EXT_MAP[file.type] ?? "bin";
  const key = `assets/${userId}/${Date.now()}-${nanoid(10)}.${ext}`;
  const contentType = file.type;
  const url = await uploadFile(buffer, key, contentType);

  let width: number | null = null;
  let height: number | null = null;
  let thumbnailKey: string | null = null;

  if (isImage) {
    try {
      const metadata = await sharp(buffer).metadata();
      width = metadata.width ?? null;
      height = metadata.height ?? null;
    } catch {
      // proceed without dimensions
    }
    try {
      thumbnailKey = await generateAndUploadThumbnail(buffer, key);
    } catch {
      // non-critical
    }
  }

  // Two-row write — assets first (FK target), then uploads. The Neon HTTP
  // driver doesn't expose db.transaction, so on the rare case the uploads
  // insert fails we hard-delete the assets row to keep the tables in sync.
  const [asset] = await db
    .insert(assets)
    .values({
      userId,
      brandId,
      status: "draft",
      source: "upload",
      brandKitOverridden: false,
      mediaType: isImage ? "image" : "video",
      model: "upload",
      provider: "upload",
      prompt: file.name,
      enhancedPrompt: null,
      parameters: { originalFilename: file.name, contentType },
      r2Key: key,
      r2Url: url,
      thumbnailR2Key: thumbnailKey,
      width,
      height,
      fileSize: file.size,
      costEstimate: 0,
    })
    .returning({ id: assets.id, createdAt: assets.createdAt });

  try {
    await db.insert(uploads).values({
      assetId: asset.id,
      uploaderId: userId,
      originalFilename: file.name,
      contentType,
    });
  } catch (err) {
    await db.delete(assets).where(eq(assets.id, asset.id));
    throw err;
  }

  const finalUrl = await getAssetUrl(key);
  const finalThumbnailUrl = thumbnailKey ? await getAssetUrl(thumbnailKey) : null;

  return NextResponse.json({
    asset: {
      id: asset.id,
      brandId,
      status: "draft" as const,
      mediaType: isImage ? ("image" as const) : ("video" as const),
      url: finalUrl,
      thumbnailUrl: finalThumbnailUrl ?? finalUrl,
      width,
      height,
      fileSize: file.size,
      createdAt: asset.createdAt,
    },
  });
}

// ---------------------------------------------------------------------------
// Reference upload (legacy, used by /generate image-input)
// ---------------------------------------------------------------------------

async function handleReferenceUpload(userId: string, file: File) {
  if (!REFERENCE_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file type. Allowed: PNG, JPEG, WebP, GIF" },
      { status: 400 }
    );
  }
  if (file.size > REFERENCE_MAX_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum size is 10 MB" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = EXT_MAP[file.type] ?? "png";
  const key = `user-uploads/${userId}/${Date.now()}-${nanoid(10)}.${ext}`;

  const url = await uploadFile(buffer, key, file.type);

  const metadata = await sharp(buffer).metadata();

  let thumbnailKey: string | undefined;
  try {
    thumbnailKey = await generateAndUploadThumbnail(buffer, key);
  } catch {
    // Non-critical — proceed without thumbnail
  }

  const [ref] = await db
    .insert(references)
    .values({
      userId,
      r2Key: key,
      r2Url: url,
      thumbnailR2Key: thumbnailKey,
      fileName: file.name,
      fileSize: file.size,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      mimeType: file.type,
    })
    .returning({ id: references.id });

  return NextResponse.json({ url, key, referenceId: ref.id });
}
