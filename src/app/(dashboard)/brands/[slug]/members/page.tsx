/**
 * /brands/[slug]/members — brand-membership editor (T056a). Phase 8b stub —
 * forwards to the brand-management surface filtered to this brand. Full
 * dedicated editor ships in a follow-up phase when the API contract on
 * `/api/brands/[id]/members` is complete.
 */

import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { getCurrentWorkspace } from "@/lib/workspace/context";

export default async function BrandMembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
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

  return (
    <div className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
      Brand-membership editor lands in the next phase. Workspace admins can
      still manage members from the workspace settings page in the meantime.
    </div>
  );
}
