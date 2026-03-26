import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadFile, generateAndUploadThumbnail } from "@/lib/storage";
import { db } from "@/lib/db";
import { references } from "@/lib/db/schema";
import { nanoid } from "nanoid";
import sharp from "sharp";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

const EXT_MAP: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file type. Allowed: PNG, JPEG, WebP, GIF" },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum size is 10 MB" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = EXT_MAP[file.type] ?? "png";
  const key = `user-uploads/${session.user.id}/${Date.now()}-${nanoid(10)}.${ext}`;

  const url = await uploadFile(buffer, key, file.type);

  // Get image dimensions
  const metadata = await sharp(buffer).metadata();

  // Generate thumbnail
  let thumbnailKey: string | undefined;
  try {
    thumbnailKey = await generateAndUploadThumbnail(buffer, key);
  } catch {
    // Non-critical — proceed without thumbnail
  }

  // Track in references table
  const [ref] = await db
    .insert(references)
    .values({
      userId: session.user.id,
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
