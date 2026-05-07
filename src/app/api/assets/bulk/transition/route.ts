/**
 * POST /api/assets/bulk/transition — apply a state transition to many assets.
 *
 * Body: `{ ids: string[] (max 200), action, note? }`.
 *
 * Always returns 200 with `{ requested, succeeded, failed }` — partial
 * failures are surfaced in `failed[]` rather than rolled back. The UI shows
 * a summary toast and reconciles its local state from `succeeded`.
 */

import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import {
  AssetMutationError,
  transitionAssetMutation,
} from "@/lib/assets/mutations";
import { type TransitionAction } from "@/lib/transitions";
import {
  loadBrandContext,
  loadRoleContext,
  type BrandContext,
  type RoleContext,
} from "@/lib/workspace/permissions";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  action: z.enum(["submit", "approve", "reject", "archive", "unarchive"]),
  note: z.string().max(2000).optional(),
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
  const { ids, action, note } = parsed.data;
  const requestedIds = Array.from(new Set(ids));

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

  // Group by brand so each BrandContext / RoleContext is loaded exactly once.
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
  await Promise.all(
    workspaceIds.map(async (wsId) => {
      ctxCache.set(wsId, await loadRoleContext(userId, wsId));
    })
  );

  for (const row of rows) {
    if (!row.brandId) {
      result.failed.push({
        id: row.id,
        code: "asset_missing_brand",
        message: "Asset has no brand context",
      });
      continue;
    }
    const brandCtx = brandCache.get(row.brandId);
    if (!brandCtx) {
      result.failed.push({
        id: row.id,
        code: "brand_not_found",
        message: "Brand not found",
      });
      continue;
    }
    const ctx = ctxCache.get(brandCtx.workspaceId);
    if (!ctx || !ctx.workspace) {
      result.failed.push({
        id: row.id,
        code: "forbidden",
        message: "Forbidden",
      });
      continue;
    }

    try {
      await transitionAssetMutation({
        asset: row,
        action: action as TransitionAction,
        ctx,
        brandCtx,
        actorId: userId,
        note,
      });
      result.succeeded.push(row.id);
    } catch (err) {
      if (err instanceof AssetMutationError) {
        result.failed.push({ id: row.id, code: err.code, message: err.message });
      } else {
        console.error("bulk transition failed", row.id, err);
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
