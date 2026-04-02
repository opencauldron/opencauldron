import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { brews, users } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { refreshUrl } from "@/lib/storage";
import { BrewDetail } from "./brew-detail";

export default async function PublicBrewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [row] = await db
    .select({
      id: brews.id,
      userId: brews.userId,
      name: brews.name,
      description: brews.description,
      model: brews.model,
      prompt: brews.prompt,
      enhancedPrompt: brews.enhancedPrompt,
      parameters: brews.parameters,
      previewUrl: brews.previewUrl,
      imageInput: brews.imageInput,
      brandId: brews.brandId,
      visibility: brews.visibility,
      slug: brews.slug,
      originalBrewId: brews.originalBrewId,
      originalUserId: brews.originalUserId,
      usageCount: brews.usageCount,
      createdAt: brews.createdAt,
      updatedAt: brews.updatedAt,
      authorName: users.name,
      authorImage: users.image,
    })
    .from(brews)
    .innerJoin(users, eq(brews.userId, users.id))
    .where(
      and(
        eq(brews.slug, slug),
        inArray(brews.visibility, ["public", "unlisted"])
      )
    );

  if (!row) notFound();

  const session = await auth();
  const isAuthenticated = !!session?.user?.id;
  const isOwner = session?.user?.id === row.userId;

  // Refresh signed URLs and serialize dates for client component
  const freshPreviewUrl = row.previewUrl
    ? (await refreshUrl(row.previewUrl)) ?? row.previewUrl
    : null;

  const freshImageInput = row.imageInput?.length
    ? await Promise.all(
        row.imageInput.map(async (url) => (await refreshUrl(url)) ?? url)
      )
    : null;

  const brew = {
    ...row,
    previewUrl: freshPreviewUrl,
    imageInput: freshImageInput,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  return (
    <BrewDetail
      brew={brew}
      isAuthenticated={isAuthenticated}
      isOwner={isOwner}
    />
  );
}
