/**
 * POST /api/assets/bulk/reassign-brand — move many assets to a target brand.
 *
 * Body: `{ ids: string[] (max 200), targetBrandId }`. Returns 200 with
 * `{ requested, succeeded, failed }`. Approved assets are intentionally
 * surfaced in `failed[]` (not rolled back) so the UI can show the user
 * which ones need a fork.
 */

import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import {
  AssetMutationError,
  reassignAssetBrand,
} from "@/lib/assets/mutations";
import {
  loadBrandContext,
  loadRoleContext,
  type BrandContext,
  type RoleContext,
} from "@/lib/workspace/permissions";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  targetBrandId: z.string().uuid(),
});

interface BulkResult {
  requested: number;
  succeeded: string[];
  failed: { id: string; code: string; message: string }[];
}

export async function POST(req: NextRequest) {
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
  const { ids, targetBrandId } = parsed.data;
  const requestedIds = Array.from(new Set(ids));

  const destBrandCtx = await loadBrandContext(targetBrandId);
  if (!destBrandCtx) {
    return NextResponse.json(
      { error: "target_brand_not_found" },
      { status: 404 }
    );
  }

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
    new Set(
      rows
        .map((r) => r.brandId)
        .filter((b): b is string => Boolean(b))
    )
  );
  const brandCache = new Map<string, BrandContext>();
  // Always include the destination brand context — its workspace anchors the
  // RoleContext load (cross-workspace moves are forbidden, so source ctxs
  // share the same workspace).
  brandCache.set(destBrandCtx.id, destBrandCtx);
  await Promise.all(
    brandIds.map(async (id) => {
      if (brandCache.has(id)) return;
      const ctx = await loadBrandContext(id);
      if (ctx) brandCache.set(id, ctx);
    })
  );

  const ctxCache = new Map<string, RoleContext>();
  const workspaceIds = Array.from(
    new Set(Array.from(brandCache.values()).map((b) => b.workspaceId))
  );
  await Promise.all(
    workspaceIds.map(async (wsId) => {
      ctxCache.set(wsId, await loadRoleContext(userId, wsId));
    })
  );

  for (const row of rows) {
    if (!row.brandId) {
      result.failed.push({
        id: row.id,
        code: "source_workspace_missing",
        message: "Asset has no source brand",
      });
      continue;
    }
    const sourceBrandCtx = brandCache.get(row.brandId);
    if (!sourceBrandCtx) {
      result.failed.push({
        id: row.id,
        code: "brand_not_found",
        message: "Source brand not found",
      });
      continue;
    }
    const ctx = ctxCache.get(sourceBrandCtx.workspaceId);
    if (!ctx) {
      result.failed.push({
        id: row.id,
        code: "forbidden",
        message: "Forbidden",
      });
      continue;
    }

    try {
      await reassignAssetBrand({
        asset: row,
        targetBrandId,
        ctx,
        sourceBrandCtx,
        destBrandCtx,
        actorId: userId,
      });
      result.succeeded.push(row.id);
    } catch (err) {
      if (err instanceof AssetMutationError) {
        result.failed.push({ id: row.id, code: err.code, message: err.message });
      } else {
        console.error("bulk reassign-brand failed", row.id, err);
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
