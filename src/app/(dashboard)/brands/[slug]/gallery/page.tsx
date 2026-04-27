/**
 * /brands/[slug]/gallery — wraps the existing gallery client filtered to
 * this brand. The gallery's own URL state honors `?brand=<id>`, so we resolve
 * the slug → id server-side and forward as a search param via redirect on
 * first load (cheap; only triggers when ?brand isn't already pinned).
 */

import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { getCurrentWorkspace } from "@/lib/workspace/context";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function BrandGalleryPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  const ws = await getCurrentWorkspace(session.user.id);
  if (!ws) notFound();

  const { slug } = await params;
  const sp = await searchParams;

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

  // The shared gallery surface lives at /gallery and supports `?brand=<id>`.
  // Forward there so we don't duplicate the (very large) gallery UI.
  const next = new URLSearchParams();
  next.set("brand", brand.id);
  for (const [k, v] of Object.entries(sp)) {
    if (v && k !== "brand") next.set(k, v);
  }
  redirect(`/gallery?${next.toString()}`);
}
