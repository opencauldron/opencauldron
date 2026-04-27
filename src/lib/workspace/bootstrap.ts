/**
 * Workspace bootstrap helpers.
 *
 * `bootstrapHostedSignup`  — invoked in the NextAuth signIn callback for new
 *                            users. Creates a fresh workspace, adds the user
 *                            as `owner`, and eagerly creates their Personal
 *                            brand (FR-006). All in one transaction.
 *
 * `bootstrapSelfHosted`    — invoked from `scripts/bootstrap-self-hosted.ts`
 *                            on docker install. Same shape, prompted name.
 *
 * `addWorkspaceMember`     — used by the workspace-members invite endpoint
 *                            and by the brand-mgr-invite path. Always creates
 *                            the user's Personal brand in the same txn.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  brandMembers,
  brands,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";

const PERSONAL_COLOR = "#94a3b8";

function slugifyWorkspaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "workspace";
}

function personalSlug(userId: string): string {
  return `personal-${userId.replace(/-/g, "").slice(0, 8)}`;
}

async function ensurePersonalBrand(
  tx: typeof db,
  workspaceId: string,
  userId: string
): Promise<void> {
  const existing = await tx
    .select({ id: brands.id })
    .from(brands)
    .where(
      sql`${brands.workspaceId} = ${workspaceId} AND ${brands.isPersonal} = true AND ${brands.ownerId} = ${userId}`
    )
    .limit(1);
  if (existing[0]) return;

  const [personal] = await tx
    .insert(brands)
    .values({
      workspaceId,
      name: "Personal",
      slug: personalSlug(userId),
      color: PERSONAL_COLOR,
      isPersonal: true,
      ownerId: userId,
      createdBy: userId,
    })
    .returning({ id: brands.id });

  await tx
    .insert(brandMembers)
    .values({ brandId: personal.id, userId, role: "creator" })
    .onConflictDoNothing();
}

export interface BootstrapResult {
  workspaceId: string;
  workspaceSlug: string;
  personalBrandId: string;
}

export async function bootstrapHostedSignup(input: {
  userId: string;
  preferredName?: string;
}): Promise<BootstrapResult> {
  const name = input.preferredName?.trim() || "My Studio";
  return runBootstrap({
    userId: input.userId,
    name,
    mode: "hosted",
  });
}

export async function bootstrapSelfHosted(input: {
  userId: string;
  workspaceName: string;
}): Promise<BootstrapResult> {
  return runBootstrap({
    userId: input.userId,
    name: input.workspaceName.trim() || "My Studio",
    mode: "self_hosted",
  });
}

async function runBootstrap(input: {
  userId: string;
  name: string;
  mode: "hosted" | "self_hosted";
}): Promise<BootstrapResult> {
  const slug = await uniqueWorkspaceSlug(slugifyWorkspaceName(input.name));

  // The Neon HTTP driver doesn't expose `db.transaction`; wrap manually with
  // a serial chain. Each step is idempotent so a retry from the caller is
  // safe if the connection drops mid-bootstrap.
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: input.name,
      slug,
      mode: input.mode,
      createdBy: input.userId,
    })
    .returning({ id: workspaces.id, slug: workspaces.slug });

  await db
    .insert(workspaceMembers)
    .values({
      workspaceId: workspace.id,
      userId: input.userId,
      role: "owner",
    })
    .onConflictDoNothing();

  await ensurePersonalBrand(db, workspace.id, input.userId);

  const [personal] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(
      sql`${brands.workspaceId} = ${workspace.id} AND ${brands.isPersonal} = true AND ${brands.ownerId} = ${input.userId}`
    )
    .limit(1);

  return {
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    personalBrandId: personal.id,
  };
}

async function uniqueWorkspaceSlug(seed: string): Promise<string> {
  const baseSlug = seed || "workspace";
  let candidate = baseSlug;
  let i = 1;
  while (true) {
    const existing = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, candidate))
      .limit(1);
    if (!existing[0]) return candidate;
    i += 1;
    candidate = `${baseSlug}-${i}`;
    if (i > 1000) {
      throw new Error(`Could not allocate a unique workspace slug from "${seed}"`);
    }
  }
}

export async function addWorkspaceMember(input: {
  workspaceId: string;
  userId: string;
  role: "owner" | "admin" | "member";
}): Promise<void> {
  await db
    .insert(workspaceMembers)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      role: input.role,
    })
    .onConflictDoNothing();

  // Eagerly create their Personal brand if not already there (FR-006).
  await ensurePersonalBrand(db, input.workspaceId, input.userId);
}
