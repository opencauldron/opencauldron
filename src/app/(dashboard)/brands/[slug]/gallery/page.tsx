/**
 * /brands/[slug]/gallery — renders the shared gallery client locked to this
 * brand. Stays inside the brand layout so the brand tab nav remains visible.
 */

import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import { GalleryClient } from "@/app/(dashboard)/gallery/gallery-client";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function BrandGalleryPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  const ws = await getCurrentWorkspace(session.user.id);
  if (!ws) notFound();

  const { slug } = await params;

  const [brand] = slug === "personal"
    ? await db
        .select({ id: brands.id })
        .from(brands)
        .where(
          and(
            eq(brands.workspaceId, ws.id),
            eq(brands.isPersonal, true),
            eq(brands.ownerId, session.user.id)
          )
        )
        .limit(1)
    : await db
        .select({ id: brands.id })
        .from(brands)
        .where(and(eq(brands.workspaceId, ws.id), eq(brands.slug, slug)))
        .limit(1);

  if (!brand) notFound();

  return <GalleryClient lockedBrandId={brand.id} />;
}
