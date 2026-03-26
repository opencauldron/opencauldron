import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { references } from "@/lib/db/schema";
import { getAssetUrl } from "@/lib/storage";
import { eq, desc, and, lt } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "30", 10), 100);

  const conditions = [eq(references.userId, session.user.id)];

  if (cursor) {
    conditions.push(lt(references.createdAt, new Date(cursor)));
  }

  const rows = await db
    .select()
    .from(references)
    .where(and(...conditions))
    .orderBy(desc(references.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const refRows = hasMore ? rows.slice(0, limit) : rows;

  const results = await Promise.all(
    refRows.map(async (r) => {
      const url = await getAssetUrl(r.r2Key);
      const thumbnailUrl = r.thumbnailR2Key
        ? await getAssetUrl(r.thumbnailR2Key)
        : null;

      return {
        id: r.id,
        userId: r.userId,
        url,
        thumbnailUrl: thumbnailUrl ?? url,
        fileName: r.fileName,
        fileSize: r.fileSize,
        width: r.width,
        height: r.height,
        mimeType: r.mimeType,
        usageCount: r.usageCount,
        createdAt: r.createdAt,
      };
    })
  );

  const nextCursor = hasMore
    ? refRows[refRows.length - 1].createdAt.toISOString()
    : null;

  return NextResponse.json({ references: results, nextCursor });
}
