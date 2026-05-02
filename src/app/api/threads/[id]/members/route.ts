/**
 * GET /api/threads/[id]/members — workspace roster for the thread.
 *
 * Returns the full list of workspace members suitable for the composer's
 * `@`-mention typeahead AND the SSE-event display-name fallback used when
 * coalescing reaction deltas.
 *
 * Auth: signed-in workspace member of the thread's workspace.
 *
 * Cache hint: clients should fetch once per thread-panel mount and reuse
 * the result for the panel's lifetime. The roster mutates rarely; staleness
 * cost is "a freshly-added member doesn't show up in typeahead until the
 * panel reopens" which is acceptable for v1.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  PermissionError,
  assertWorkspaceMemberForThread,
} from "@/lib/threads/permissions";
import { resolveWorkspaceMembersForMention } from "@/lib/threads/resolve-mentions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: threadId } = await params;

  let perm;
  try {
    perm = await assertWorkspaceMemberForThread(userId, threadId);
  } catch (err) {
    if (err instanceof PermissionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const members = await resolveWorkspaceMembersForMention(perm.workspaceId);
  return NextResponse.json({
    members: members.map((m) => ({
      id: m.id,
      handle: m.handle,
      displayName: m.displayName,
      avatarUrl: m.avatarUrl,
    })),
  });
}
