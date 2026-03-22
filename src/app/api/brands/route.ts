import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brands, assetBrands, users } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

const createBrandSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a valid hex color"),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await db
    .select({
      id: brands.id,
      name: brands.name,
      color: brands.color,
      createdBy: brands.createdBy,
      createdAt: brands.createdAt,
      assetCount: sql<number>`count(${assetBrands.assetId})::int`,
    })
    .from(brands)
    .leftJoin(assetBrands, eq(brands.id, assetBrands.brandId))
    .groupBy(brands.id)
    .orderBy(brands.name);

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check admin role
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (user?.role !== "admin") {
    return NextResponse.json(
      { error: "Only admins can create brands" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = createBrandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const [brand] = await db
      .insert(brands)
      .values({
        name: parsed.data.name,
        color: parsed.data.color,
        createdBy: session.user.id,
      })
      .returning();

    return NextResponse.json(brand, { status: 201 });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("unique")
    ) {
      return NextResponse.json(
        { error: "A brand with that name already exists" },
        { status: 409 }
      );
    }
    throw error;
  }
}
