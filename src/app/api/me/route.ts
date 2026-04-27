import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCurrentWorkspace } from "@/lib/workspace/context";
import { loadRoleContext, countNonPersonalBrandMemberships, canBrowsePublicBrews } from "@/lib/workspace/permissions";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await getCurrentWorkspace(session.user.id);
  if (!workspace) {
    return NextResponse.json({
      userId: session.user.id,
      workspace: null,
      role: null,
      canGenerateVideo: false,
      brandRoles: {},
      canBrowsePublicBrews: false,
    });
  }

  const ctx = await loadRoleContext(session.user.id, workspace.id);
  const nonPersonalCount = await countNonPersonalBrandMemberships(ctx);

  return NextResponse.json({
    userId: session.user.id,
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug, mode: workspace.mode },
    role: ctx.workspace?.role ?? null,
    canGenerateVideo: ctx.workspace?.canGenerateVideo ?? false,
    brandRoles: Object.fromEntries(ctx.brandMemberships),
    canBrowsePublicBrews: canBrowsePublicBrews(ctx, nonPersonalCount),
  });
}
