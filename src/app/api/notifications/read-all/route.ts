/**
 * POST /api/notifications/read-all
 *
 * Marks every unread notification owned by the current user in the active
 * workspace as read. Idempotent — a second call is a no-op.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { markAllRead } from "@/lib/notifications";
import { getCurrentWorkspace } from "@/lib/workspace/context";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getCurrentWorkspace(session.user.id);
  if (!workspace) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  const updated = await markAllRead(session.user.id, workspace.id);
  return NextResponse.json({ ok: true, updated });
}
