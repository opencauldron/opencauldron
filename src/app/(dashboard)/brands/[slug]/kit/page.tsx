/**
 * /brands/[slug]/kit — minimum-viable brand-kit editor (T060 + T079b). Shows
 * prefix, suffix, banned terms, color, palette, video toggle, self-approval
 * toggle. Edits land via PATCH /api/brands/[id]; the route already gates on
 * `canEditBrandKit` so unauthorised members get 403.
 *
 * The "Danger Zone" delete card sits below the kit editor for non-personal
 * brands when the caller has brand_manager+ rights — same gate the DELETE
 * endpoint enforces. Personal brands never see it.
 */

import { notFound, redirect } from "next/navigation";
import { and, eq, ne, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets, brands, brews, users } from "@/lib/db/schema";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import {
  isBrandManager,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { getAssetUrl } from "@/lib/storage";
import { BrandKitEditor } from "./brand-kit-editor";
import { BrandDangerZone } from "./brand-danger-zone";

export default async function BrandKitPage({
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
        .select()
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
        .select()
        .from(brands)
        .where(and(eq(brands.workspaceId, ws.id), eq(brands.slug, slug)))
        .limit(1);

  if (!brand) notFound();

  const ctx = await loadRoleContext(session.user.id, ws.id);
  const canEdit = isBrandManager(ctx, brand.id);

  const logoUrl = brand.logoR2Key ? await getAssetUrl(brand.logoR2Key) : null;
  let ownerImage: string | null = null;
  if (brand.isPersonal && brand.ownerId) {
    const [u] = await db
      .select({ image: users.image })
      .from(users)
      .where(eq(users.id, brand.ownerId))
      .limit(1);
    ownerImage = u?.image ?? null;
  }

  // Danger Zone is gated by the same isBrandManager check the DELETE endpoint
  // uses. We pre-load the inventory + reassign targets server-side so the
  // modal opens instantly without a follow-up fetch.
  let dangerZone: React.ReactNode = null;
  if (!brand.isPersonal && canEdit) {
    const [{ assetCount = 0 } = { assetCount: 0 }] = await db
      .select({ assetCount: sql<number>`count(*)::int` })
      .from(assets)
      .where(eq(assets.brandId, brand.id));
    const [{ brewCount = 0 } = { brewCount: 0 }] = await db
      .select({ brewCount: sql<number>`count(*)::int` })
      .from(brews)
      .where(eq(brews.brandId, brand.id));

    const targets = await db
      .select({
        id: brands.id,
        name: brands.name,
        slug: brands.slug,
      })
      .from(brands)
      .where(
        and(
          eq(brands.workspaceId, ws.id),
          eq(brands.isPersonal, false),
          ne(brands.id, brand.id)
        )
      )
      .orderBy(brands.name);

    dangerZone = (
      <BrandDangerZone
        brand={{
          id: brand.id,
          name: brand.name,
          slug: brand.slug,
          assetCount,
          brewCount,
        }}
        availableTargets={targets.map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
        }))}
      />
    );
  }

  return (
    <div className="space-y-8">
      <BrandKitEditor
        brand={{
          id: brand.id,
          name: brand.name,
          color: brand.color,
          promptPrefix: brand.promptPrefix,
          promptSuffix: brand.promptSuffix,
          bannedTerms: brand.bannedTerms,
          defaultLoraId: brand.defaultLoraId,
          videoEnabled: brand.videoEnabled,
          selfApprovalAllowed: brand.selfApprovalAllowed,
          isPersonal: brand.isPersonal,
          logoUrl,
          ownerImage,
        }}
        canEdit={canEdit}
      />
      {dangerZone}
    </div>
  );
}
