/**
 * POST /api/notifications/[id]/read
 *
 * Marks a single notification as read. 404 when the row doesn't exist or is
 * owned by a different user — same response either way so we don't leak the
 * existence of other users' notification ids.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { markRead } from "@/lib/notifications";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const ok = await markRead(session.user.id, id);
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
