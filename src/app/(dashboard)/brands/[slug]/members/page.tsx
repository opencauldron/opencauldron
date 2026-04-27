/**
 * /brands/[slug]/members — brand-membership editor.
 *
 * Server component:
 *   - Resolves the brand by slug (with the `personal` sentinel handled).
 *   - Gates manage access via `isBrandManager` (FR-038 / FR-039 — same gate the
 *     authoritative API route uses). Non-managers see a polite read-only
 *     placeholder; the API enforces the same rule on every mutation (NFR-004).
 *   - Loads the initial member list server-side so the editor renders without
 *     a loading flicker; subsequent CRUD goes through the existing JSON API.
 */

import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brandMembers, brands, users } from "@/lib/db/schema";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import {
  isBrandManager,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { MembersEditor, type MemberRow } from "./members-editor";

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
  const [brand] =
    slug === "personal"
      ? await db
          .select({
            id: brands.id,
            name: brands.name,
            color: brands.color,
            isPersonal: brands.isPersonal,
          })
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
          .select({
            id: brands.id,
            name: brands.name,
            color: brands.color,
            isPersonal: brands.isPersonal,
          })
          .from(brands)
          .where(and(eq(brands.workspaceId, ws.id), eq(brands.slug, slug)))
          .limit(1);

  if (!brand) notFound();

  const ctx = await loadRoleContext(session.user.id, ws.id);
  const canManage = isBrandManager(ctx, brand.id);

  // Personal brands aren't a team surface — they're a single-user space.
  // Surface that explicitly rather than rendering an empty editor.
  if (brand.isPersonal) {
    return (
      <div className="max-w-2xl space-y-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Members</h2>
          <p className="text-sm text-muted-foreground">
            Personal brands aren&apos;t shared — they belong to one person.
            Create a team brand from the brands page to invite collaborators.
          </p>
        </header>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="max-w-2xl space-y-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Members</h2>
          <p className="text-sm text-muted-foreground">
            Invite teammates to this brand and assign their permissions.
          </p>
        </header>
        <div className="rounded-lg border border-border/60 bg-card p-6 text-sm text-muted-foreground">
          You don&apos;t have permission to manage this brand&apos;s members.
          Ask a brand manager or studio admin to make changes here.
        </div>
      </div>
    );
  }

  const memberRows = await db
    .select({
      userId: brandMembers.userId,
      role: brandMembers.role,
      email: users.email,
      name: users.name,
      image: users.image,
    })
    .from(brandMembers)
    .innerJoin(users, eq(users.id, brandMembers.userId))
    .where(eq(brandMembers.brandId, brand.id));

  const initialMembers: MemberRow[] = memberRows.map((m) => ({
    userId: m.userId,
    role: m.role as MemberRow["role"],
    email: m.email,
    name: m.name,
    image: m.image,
  }));

  return (
    <MembersEditor
      brand={{ id: brand.id, name: brand.name, color: brand.color }}
      currentUserId={session.user.id}
      initialMembers={initialMembers}
    />
  );
}
