/**
 * /brands/[slug]/campaigns — brand campaigns admin page (T145).
 * Resolves the brand and renders the client editor scoped to that brand.
 */

import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import {
  isBrandManager,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { CampaignsClient } from "./campaigns-client";

export default async function BrandCampaignsPage({
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
        .select({ id: brands.id, name: brands.name, isPersonal: brands.isPersonal })
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
        .select({ id: brands.id, name: brands.name, isPersonal: brands.isPersonal })
        .from(brands)
        .where(and(eq(brands.workspaceId, ws.id), eq(brands.slug, slug)))
        .limit(1);

  if (!brand) notFound();

  if (brand.isPersonal) {
    return (
      <div className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
        Personal brands don&apos;t support campaigns.
      </div>
    );
  }

  const ctx = await loadRoleContext(session.user.id, ws.id);
  const canManage = isBrandManager(ctx, brand.id);

  return <CampaignsClient brandId={brand.id} brandName={brand.name} canManage={canManage} />;
}
