/**
 * Current-workspace resolver.
 *
 * In `hosted` mode the user can hold multiple workspace memberships; this
 * resolver picks one (cookie hint → most recent created) and the API trusts
 * the chosen workspace as the request's tenant boundary.
 *
 * In `self_hosted` mode the workspace concept is invisible chrome; we always
 * return the singleton workspace.
 */

import { cookies } from "next/headers";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { workspaceMembers, workspaces } from "@/lib/db/schema";

const WORKSPACE_COOKIE = "current_workspace_id";

export interface CurrentWorkspace {
  id: string;
  name: string;
  slug: string;
  mode: "hosted" | "self_hosted";
  logoUrl: string | null;
}

export async function getCurrentWorkspace(
  userId: string
): Promise<CurrentWorkspace | null> {
  if (env.WORKSPACE_MODE === "self_hosted") {
    const ws = await db.select().from(workspaces).limit(1);
    if (!ws[0]) return null;
    return {
      id: ws[0].id,
      name: ws[0].name,
      slug: ws[0].slug,
      mode: ws[0].mode as "hosted" | "self_hosted",
      logoUrl: ws[0].logoUrl ?? null,
    };
  }

  const memberships = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      mode: workspaces.mode,
      logoUrl: workspaces.logoUrl,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(desc(workspaces.createdAt));

  if (memberships.length === 0) return null;
  if (memberships.length === 1) {
    return mapToCurrent(memberships[0]);
  }

  // Multiple memberships — honour the cookie if it points at one of them.
  const cookieStore = await cookies();
  const hint = cookieStore.get(WORKSPACE_COOKIE)?.value;
  const match = memberships.find((m) => m.id === hint);
  return mapToCurrent(match ?? memberships[0]);
}

export async function listUserWorkspaces(userId: string) {
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaces.name);
}

export async function userIsWorkspaceMember(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const rows = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.workspaceId, workspaceId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

function mapToCurrent(row: {
  id: string;
  name: string;
  slug: string;
  mode: string;
  logoUrl: string | null;
}): CurrentWorkspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    mode: row.mode as "hosted" | "self_hosted",
    logoUrl: row.logoUrl,
  };
}

export const CURRENT_WORKSPACE_COOKIE = WORKSPACE_COOKIE;
