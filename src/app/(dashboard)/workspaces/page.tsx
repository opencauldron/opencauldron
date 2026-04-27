import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import { loadRoleContext } from "@/lib/workspace/permissions";
import { WorkspaceSettingsClient } from "./workspace-settings-client";

export const dynamic = "force-dynamic";

export default async function WorkspacesPage() {
  // FR-028 — workspace settings are hosted-only chrome.
  if (env.WORKSPACE_MODE === "self_hosted") {
    redirect("/overview");
  }

  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const workspace = await getCurrentWorkspace(session.user.id);
  if (!workspace) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Workspace</h1>
        <p className="text-muted-foreground">
          You aren&apos;t in a workspace yet. Sign out and back in to bootstrap one.
        </p>
      </div>
    );
  }

  const ctx = await loadRoleContext(session.user.id, workspace.id);

  return (
    <WorkspaceSettingsClient
      workspace={workspace}
      role={ctx.workspace?.role ?? "member"}
    />
  );
}
