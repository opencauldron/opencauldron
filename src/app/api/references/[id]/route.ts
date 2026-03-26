import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { references } from "@/lib/db/schema";
import { deleteFile } from "@/lib/storage";
import { eq, and } from "drizzle-orm";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [ref] = await db
    .select({
      id: references.id,
      userId: references.userId,
      r2Key: references.r2Key,
      thumbnailR2Key: references.thumbnailR2Key,
    })
    .from(references)
    .where(and(eq(references.id, id), eq(references.userId, session.user.id)))
    .limit(1);

  if (!ref) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Delete from storage
  try {
    await deleteFile(ref.r2Key);
    if (ref.thumbnailR2Key) {
      await deleteFile(ref.thumbnailR2Key);
    }
  } catch (error) {
    console.error("Failed to delete reference from storage:", error);
  }

  await db.delete(references).where(eq(references.id, id));

  return NextResponse.json({ success: true });
}
