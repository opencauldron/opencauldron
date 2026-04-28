/**
 * /settings/studio — Studio settings (rename / re-slug / set logo URL).
 *
 * Owner / admin only — non-admins get a 403 page. The actual mutation goes
 * through `PATCH /api/workspaces/[id]` which already enforces the same gate
 * server-side (NFR-004 — server is authoritative).
 */

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import {
  isWorkspaceAdmin,
  loadRoleContext,
} from "@/lib/workspace/permissions";
import { StudioSettingsForm } from "./studio-settings-form";

export const dynamic = "force-dynamic";

export default async function StudioSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const workspace = await getCurrentWorkspace(session.user.id);
  if (!workspace) {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Studio</h1>
        </header>
        <p className="text-sm text-muted-foreground">
          You aren&apos;t in a studio yet. Sign out and back in to bootstrap one.
        </p>
      </div>
    );
  }

  const ctx = await loadRoleContext(session.user.id, workspace.id);
  if (!isWorkspaceAdmin(ctx)) {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Studio</h1>
          <p className="text-sm text-muted-foreground">
            Studio settings are owner/admin-only.
          </p>
        </header>
        <div className="rounded-lg border border-border/60 bg-card p-6 text-sm text-muted-foreground">
          You don&apos;t have access to this page. Ask a studio owner or admin
          to make changes here.
        </div>
      </div>
    );
  }

  // Load the full row so we can prefill `logoUrl` (not on the trimmed
  // `getCurrentWorkspace` shape).
  const [row] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspace.id))
    .limit(1);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Studio</h1>
        <p className="text-sm text-muted-foreground">
          Manage your studio name, URL slug, and logo.
        </p>
      </header>

      <StudioSettingsForm
        workspace={{
          id: row.id,
          name: row.name,
          slug: row.slug,
          logoUrl: row.logoUrl ?? "",
        }}
      />
    </div>
  );
}
