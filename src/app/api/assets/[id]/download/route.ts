import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assetCampaigns, assets, brands, campaigns } from "@/lib/db/schema";
import { checkAndConsumeIpRateLimit } from "@/lib/public/rate-limit";
import { getAssetObject } from "@/lib/storage";
import { canRead, loadRoleContext } from "@/lib/workspace/permissions";
import { and, eq } from "drizzle-orm";

/**
 * Same-origin download proxy. The client uses an `<a href download>` click on
 * this URL instead of fetching the storage URL directly — avoids R2 CORS
 * config and forces a browser download (with a sensible filename) regardless
 * of whether the bucket sets `Content-Disposition`.
 *
 * Query params:
 *   variant: "webp" | "original"  (default "original")
 */

const ALLOWED_VARIANTS = new Set(["webp", "original"] as const);
type Variant = "webp" | "original";

function extensionFor(mimeType: string | null): string {
  if (!mimeType) return "bin";
  const lower = mimeType.toLowerCase();
  if (lower === "image/jpeg" || lower === "image/jpg") return "jpg";
  if (lower === "image/png") return "png";
  if (lower === "image/webp") return "webp";
  if (lower === "image/gif") return "gif";
  if (lower === "image/avif") return "avif";
  if (lower === "image/heic") return "heic";
  if (lower === "video/mp4") return "mp4";
  if (lower === "video/webm") return "webm";
  if (lower === "video/quicktime") return "mov";
  const slash = lower.indexOf("/");
  return slash >= 0 ? lower.slice(slash + 1).split(/[+;]/)[0] : "bin";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const variantParam = req.nextUrl.searchParams.get("variant") ?? "original";
  if (!ALLOWED_VARIANTS.has(variantParam as Variant)) {
    return NextResponse.json({ error: "Invalid variant" }, { status: 400 });
  }
  const variant = variantParam as Variant;

  const [asset] = await db
    .select({
      id: assets.id,
      userId: assets.userId,
      brandId: assets.brandId,
      status: assets.status,
      r2Key: assets.r2Key,
      webpR2Key: assets.webpR2Key,
      webpStatus: assets.webpStatus,
      originalMimeType: assets.originalMimeType,
      mediaType: assets.mediaType,
      brandWorkspaceId: brands.workspaceId,
    })
    .from(assets)
    .leftJoin(brands, eq(brands.id, assets.brandId))
    .where(eq(assets.id, id))
    .limit(1);

  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  /**
   * Auth gate.
   *
   * Authenticated callers go through the existing in-app permission check
   * (workspace role + asset visibility) — unchanged behavior.
   *
   * Unauthenticated callers are normally rejected with 401, but a NARROW
   * bypass admits requests for assets that roll up to a `visibility = 'public'`
   * campaign AND are themselves `status = 'approved'` (US2 / FR-012, plan D12).
   *
   * Defense in depth — the bypass query joins through the `asset_campaigns`
   * junction table, which is the ONLY campaign↔asset relationship in the
   * schema (there is no `assets.campaign_id` direct FK; see
   * `src/lib/db/schema.ts:261-348` for `assets` and `:411-422` for the
   * junction). Both predicates (`assets.status = 'approved'` AND
   * `campaigns.visibility = 'public'`) MUST match for the EXISTS to return a
   * row, so this cannot become a back door for arbitrary asset IDs:
   *   - draft / in_review / rejected / archived assets fail the status check
   *   - assets attached only to private campaigns fail the visibility check
   *   - assets attached to no campaign at all fail the join
   *
   * Unauthenticated requests are also rate-limited by IP (T017/T021) — see
   * `specs/public-campaign-galleries/spec.md` NFR-004.
   */
  const session = await auth();

  if (session?.user?.id) {
    // Authenticated path: existing in-app permission gate. Mirrors
    // GET /api/assets/[id].
    if (asset.brandId && asset.brandWorkspaceId) {
      const ctx = await loadRoleContext(
        session.user.id,
        asset.brandWorkspaceId
      );
      if (!canRead(ctx, { brandId: asset.brandId, userId: asset.userId })) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    } else if (asset.userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  } else {
    // Unauthenticated path — rate-limit per IP first (T017/T021, NFR-004).
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rl = checkAndConsumeIpRateLimit(ip, {
      maxPerMinute: 30,
      burstPer5s: 5,
    });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
        }
      );
    }

    // Public-campaign bypass. The asset must be `approved` AND attached (via
    // the `asset_campaigns` junction — the ONLY campaign↔asset relationship)
    // to a campaign with `visibility = 'public'`.
    if (asset.status !== "approved") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const [hit] = await db
      .select({ id: assetCampaigns.assetId })
      .from(assetCampaigns)
      .innerJoin(campaigns, eq(campaigns.id, assetCampaigns.campaignId))
      .where(
        and(
          eq(assetCampaigns.assetId, asset.id),
          eq(campaigns.visibility, "public")
        )
      )
      .limit(1);
    if (!hit) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let key: string;
  let filename: string;
  const id8 = asset.id.slice(0, 8);

  if (variant === "webp") {
    if (asset.webpStatus !== "ready" || !asset.webpR2Key) {
      return NextResponse.json({ error: "WebP not available" }, { status: 404 });
    }
    key = asset.webpR2Key;
    filename = `opencauldron-${id8}.webp`;
  } else {
    key = asset.r2Key;
    const fallbackMime = asset.mediaType === "video" ? "video/mp4" : null;
    const ext = extensionFor(asset.originalMimeType ?? fallbackMime);
    filename = `opencauldron-${id8}-original.${ext}`;
  }

  let object;
  try {
    object = await getAssetObject(key);
  } catch (err) {
    console.error("Download proxy: failed to fetch object", { id, variant, err });
    return NextResponse.json({ error: "Storage error" }, { status: 502 });
  }

  const headers = new Headers();
  headers.set(
    "Content-Type",
    object.contentType ??
      (variant === "webp" ? "image/webp" : "application/octet-stream")
  );
  // RFC 5987 — encode the filename so non-ASCII chars survive. We always
  // generate ASCII-safe names ourselves but include `filename*` for safety.
  headers.set(
    "Content-Disposition",
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  if (object.contentLength != null) {
    headers.set("Content-Length", String(object.contentLength));
  }
  // Don't let a browser/CDN cache the bytes under the proxy URL — the
  // underlying object is already cached behind its public URL where we want
  // hits to land.
  headers.set("Cache-Control", "private, no-store");

  return new NextResponse(object.body, { headers });
}
