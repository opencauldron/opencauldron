/**
 * DELETE /api/assets/bulk — delete many assets.
 *
 * Body: `{ ids: string[] (max 200) }`. Returns 200 with
 * `{ requested, succeeded, failed }`. Approved assets land in `failed[]`
 * with `code: "asset_immutable"` so the UI can surface the fork prompt.
 */

import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { AssetMutationError, deleteAsset } from "@/lib/assets/mutations";
import {
  loadBrandContext,
  loadRoleContext,
  type BrandContext,
  type RoleContext,
} from "@/lib/workspace/permissions";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

interface BulkResult {
  requested: number;
  succeeded: string[];
  failed: { id: string; code: string; message: string }[];
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const requestedIds = Array.from(new Set(parsed.data.ids));

  const rows = await db
    .select({
      id: assets.id,
      userId: assets.userId,
      brandId: assets.brandId,
      status: assets.status,
      prompt: assets.prompt,
      r2Key: assets.r2Key,
      thumbnailR2Key: assets.thumbnailR2Key,
      webpR2Key: assets.webpR2Key,
    })
    .from(assets)
    .where(inArray(assets.id, requestedIds));

  const result: BulkResult = {
    requested: requestedIds.length,
    succeeded: [],
    failed: [],
  };
  const seen = new Set(rows.map((r) => r.id));
  for (const id of requestedIds) {
    if (!seen.has(id)) {
      result.failed.push({
        id,
        code: "not_found",
        message: "Asset not found",
      });
    }
  }

  const brandIds = Array.from(
    new Set(rows.map((r) => r.brandId).filter((b): b is string => Boolean(b)))
  );
  const brandCache = new Map<string, BrandContext>();
  await Promise.all(
    brandIds.map(async (id) => {
      const ctx = await loadBrandContext(id);
      if (ctx) brandCache.set(id, ctx);
    })
  );

  const ctxCache = new Map<string, RoleContext>();
  const workspaceIds = Array.from(
    new Set(Array.from(brandCache.values()).map((b) => b.workspaceId))
  );
  // Orphan assets (no brand) still need a RoleContext for the workspace-admin
  // override path, but with no workspace anchor the helper returns the
  // creator-only branch — match that here by skipping the load.
  await Promise.all(
    workspaceIds.map(async (wsId) => {
      ctxCache.set(wsId, await loadRoleContext(userId, wsId));
    })
  );

  for (const row of rows) {
    const brandCtx = row.brandId ? brandCache.get(row.brandId) ?? null : null;
    const ctx = brandCtx
      ? ctxCache.get(brandCtx.workspaceId)
      : ({
          userId,
          workspace: null,
          brandMemberships: new Map(),
        } satisfies RoleContext);
    if (!ctx) {
      result.failed.push({
        id: row.id,
        code: "forbidden",
        message: "Forbidden",
      });
      continue;
    }
    try {
      await deleteAsset({ asset: row, ctx, brandCtx, actorId: userId });
      result.succeeded.push(row.id);
    } catch (err) {
      if (err instanceof AssetMutationError) {
        result.failed.push({ id: row.id, code: err.code, message: err.message });
      } else {
        console.error("bulk delete failed", row.id, err);
        result.failed.push({
          id: row.id,
          code: "internal_error",
          message: "Internal error",
        });
      }
    }
  }

  return NextResponse.json(result);
}
