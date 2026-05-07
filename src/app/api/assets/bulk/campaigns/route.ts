/**
 * PATCH /api/assets/bulk/campaigns — set/add/remove campaigns on many assets.
 *
 * Body: `{ ids, campaignIds, mode: "set" | "add" | "remove" }` (max 200 ids,
 * max 32 campaign ids). Cross-brand selections are surfaced as `failed[]`
 * entries since campaigns are brand-scoped — the UI prevents this case via
 * the picker, but the server is the source of truth.
 */

import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import {
  AssetMutationError,
  setAssetCampaigns,
  type CampaignMode,
} from "@/lib/assets/mutations";
import {
  loadBrandContext,
  loadRoleContext,
  type BrandContext,
  type RoleContext,
} from "@/lib/workspace/permissions";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  campaignIds: z.array(z.string().uuid()).max(32),
  mode: z.enum(["set", "add", "remove"]),
});

interface BulkResult {
  requested: number;
  succeeded: string[];
  failed: { id: string; code: string; message: string }[];
}

export async function PATCH(req: NextRequest) {
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
  const { ids, campaignIds, mode } = parsed.data;
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
    if (!ctx) {
      result.failed.push({
        id: row.id,
        code: "forbidden",
        message: "Forbidden",
      });
      continue;
    }

    try {
      await setAssetCampaigns({
        asset: row,
        brandCtx,
        ctx,
        campaignIds,
        mode: mode as CampaignMode,
      });
      result.succeeded.push(row.id);
    } catch (err) {
      if (err instanceof AssetMutationError) {
        result.failed.push({ id: row.id, code: err.code, message: err.message });
      } else {
        console.error("bulk campaigns failed", row.id, err);
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
