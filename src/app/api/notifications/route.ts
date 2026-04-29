/**
 * GET /api/notifications
 *
 * Returns the most-recent 20 notifications for the current user in the
 * active workspace, plus the workspace-scoped unread count for the bell
 * badge. Returns an empty feed (not 404) when the user has no workspace yet
 * — matches the shape `/api/me` uses for unbootstrapped users.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { loadFeed } from "@/lib/notifications";
import { getCurrentWorkspace } from "@/lib/workspace/context";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getCurrentWorkspace(session.user.id);
  if (!workspace) {
    return NextResponse.json({ items: [], unreadCount: 0 });
  }

  const { items, unreadCount } = await loadFeed({
    userId: session.user.id,
    workspaceId: workspace.id,
  });

  return NextResponse.json({ items, unreadCount });
}
