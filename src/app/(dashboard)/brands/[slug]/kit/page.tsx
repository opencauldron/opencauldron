/**
 * /brands/[slug]/kit — minimum-viable brand-kit editor (T060 + T079b). Shows
 * prefix, suffix, banned terms, color, palette, video toggle, self-approval
 * toggle. Edits land via PATCH /api/brands/[id]; the route already gates on
 * `canEditBrandKit` so unauthorised members get 403.
 */

import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brands, users } from "@/lib/db/schema";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import {
  isBrandManager,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { getAssetUrl } from "@/lib/storage";
import { BrandKitEditor } from "./brand-kit-editor";

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

  return (
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
  );
}
