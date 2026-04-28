/**
 * Pure-function tests for the asset-upload validation contract (T123 / US6).
 *
 * Mirrors the Phase 5/6 pattern (`transitions.test.ts`, `permissions.test.ts`)
 * — no `INTEGRATION_DATABASE_URL`, no DB, no NextRequest mock. The asset-
 * upload route is monolithic (formData parsing + auth + DB queries +
 * permissions); we factor the validation block out into a pure helper
 * (`validateAssetUpload`) and test the contract here. The route's runtime
 * path uses the same helper so the table here is the spec.
 *
 * Validation contract:
 *   FR (size)      50 MiB max → 413 file_too_large with maxBytes.
 *   FR (mime)      4 image + 3 video types → unsupported others 400 with allowed list.
 *   FR (mediaType) image vs video derived from MIME on success.
 *
 * Permission gate (`canCreateAsset`) is verified at the input contract level —
 * the route uses it as the brand-create gate, so a viewer must be denied and
 * a creator allowed.
 */

import { describe, expect, it } from "vitest";
import {
  ASSET_MAX_SIZE,
  ASSET_IMAGE_TYPES,
  ASSET_VIDEO_TYPES,
  validateAssetUpload,
} from "@/app/api/uploads/validation";
import {
  canCreateAsset,
  type BrandContext,
  type BrandRole,
  type RoleContext,
  type WorkspaceRole,
} from "@/lib/workspace/permissions";

const WS = "ws-1";
const BRAND = "brand-a";
const ME = "user-me";

function mkCtx(opts: {
  workspaceRole: WorkspaceRole | null;
  brandRoles?: Array<[string, BrandRole]>;
}): RoleContext {
  return {
    userId: ME,
    workspace:
      opts.workspaceRole === null
        ? null
        : {
            workspaceId: WS,
            role: opts.workspaceRole,
            canGenerateVideo: false,
          },
    brandMemberships: new Map(opts.brandRoles ?? []),
  };
}

function mkBrand(opts: { id?: string; workspaceId?: string; isPersonal?: boolean } = {}): BrandContext {
  return {
    id: opts.id ?? BRAND,
    workspaceId: opts.workspaceId ?? WS,
    isPersonal: opts.isPersonal ?? false,
    ownerId: null,
    videoEnabled: true,
    selfApprovalAllowed: false,
  };
}

describe("asset upload validation (US6 / T123)", () => {
  // ---------------------------------------------------------------------------
  // Constants — guard against accidental drift in the route. These numbers are
  // load-bearing: the dropzone surfaces "50 MB" to users and the dashboard's
  // quota math assumes 50 MiB exactly.
  // ---------------------------------------------------------------------------
  describe("constants", () => {
    it("ASSET_MAX_SIZE is exactly 50 MiB", () => {
      expect(ASSET_MAX_SIZE).toBe(50 * 1024 * 1024);
      expect(ASSET_MAX_SIZE).toBe(52_428_800);
    });
    it("ASSET_IMAGE_TYPES is the 4 standard web image MIMEs", () => {
      expect(ASSET_IMAGE_TYPES).toEqual([
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
      ]);
    });
    it("ASSET_VIDEO_TYPES is the 3 supported short-video MIMEs", () => {
      expect(ASSET_VIDEO_TYPES).toEqual([
        "video/mp4",
        "video/quicktime",
        "video/webm",
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // Size gate (413 path)
  // ---------------------------------------------------------------------------
  describe("size gate", () => {
    it("rejects > 50 MiB image with 413 + file_too_large + maxBytes", () => {
      const v = validateAssetUpload({ type: "image/png", size: ASSET_MAX_SIZE + 1 });
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(v.status).toBe(413);
        expect(v.error).toBe("file_too_large");
        expect(v.maxBytes).toBe(52_428_800);
      }
    });

    it("rejects very large video with 413", () => {
      const v = validateAssetUpload({ type: "video/mp4", size: 100 * 1024 * 1024 });
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(v.status).toBe(413);
        expect(v.error).toBe("file_too_large");
      }
    });

    it("accepts exactly 50 MiB image (boundary inclusive)", () => {
      const v = validateAssetUpload({ type: "image/png", size: ASSET_MAX_SIZE });
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.mediaType).toBe("image");
    });

    it("accepts exactly 50 MiB video (boundary inclusive)", () => {
      const v = validateAssetUpload({ type: "video/mp4", size: ASSET_MAX_SIZE });
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.mediaType).toBe("video");
    });

    it("accepts a 0-byte file (size gate is upper-bound only)", () => {
      const v = validateAssetUpload({ type: "image/png", size: 0 });
      expect(v.ok).toBe(true);
    });

    // MIME gate runs first — make that explicit so a future reorder shows up.
    it("MIME gate runs before size gate (huge unsupported file → 400, not 413)", () => {
      const v = validateAssetUpload({ type: "text/plain", size: ASSET_MAX_SIZE * 10 });
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(v.status).toBe(400);
        expect(v.error).toBe("unsupported_type");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // MIME gate (400 path)
  // ---------------------------------------------------------------------------
  describe("MIME gate", () => {
    it("rejects text/plain with 400 + unsupported_type + allowed list", () => {
      const v = validateAssetUpload({ type: "text/plain", size: 100 });
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(v.status).toBe(400);
        expect(v.error).toBe("unsupported_type");
        expect(v.allowed).toEqual([
          ...ASSET_IMAGE_TYPES,
          ...ASSET_VIDEO_TYPES,
        ]);
      }
    });

    it("rejects application/pdf with 400 + unsupported_type", () => {
      const v = validateAssetUpload({ type: "application/pdf", size: 100 });
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(v.status).toBe(400);
        expect(v.error).toBe("unsupported_type");
      }
    });

    it("rejects empty MIME string", () => {
      const v = validateAssetUpload({ type: "", size: 100 });
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error).toBe("unsupported_type");
    });

    it("rejects close-but-wrong MIMEs (image/svg+xml, video/x-matroska)", () => {
      const svg = validateAssetUpload({ type: "image/svg+xml", size: 100 });
      expect(svg.ok).toBe(false);
      const mkv = validateAssetUpload({ type: "video/x-matroska", size: 100 });
      expect(mkv.ok).toBe(false);
    });

    it("MIME match is case-sensitive (PNG uppercase rejected)", () => {
      const v = validateAssetUpload({ type: "IMAGE/PNG", size: 100 });
      expect(v.ok).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Accepted MIMEs → mediaType derivation
  // ---------------------------------------------------------------------------
  describe("mediaType derivation", () => {
    for (const mime of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      it(`${mime} → mediaType=image`, () => {
        const v = validateAssetUpload({ type: mime, size: 1000 });
        expect(v.ok).toBe(true);
        if (v.ok) expect(v.mediaType).toBe("image");
      });
    }

    for (const mime of ["video/mp4", "video/quicktime", "video/webm"]) {
      it(`${mime} → mediaType=video`, () => {
        const v = validateAssetUpload({ type: mime, size: 1000 });
        expect(v.ok).toBe(true);
        if (v.ok) expect(v.mediaType).toBe("video");
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Permission gate — `canCreateAsset` is the route's brand-create gate.
  // We assert the contract at the input boundary here; the matrix as a whole
  // is covered in `permissions.test.ts`.
  // ---------------------------------------------------------------------------
  describe("brand-create permission gate (canCreateAsset)", () => {
    const realBrand = mkBrand();

    it("viewer on brand → denied", () => {
      const ctx = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "viewer"]] });
      expect(canCreateAsset(ctx, realBrand)).toBe(false);
    });

    it("creator on brand → allowed", () => {
      const ctx = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]] });
      expect(canCreateAsset(ctx, realBrand)).toBe(true);
    });

    it("brand_manager on brand → allowed", () => {
      const ctx = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] });
      expect(canCreateAsset(ctx, realBrand)).toBe(true);
    });

    it("workspace member with no brand role → denied", () => {
      const ctx = mkCtx({ workspaceRole: "member" });
      expect(canCreateAsset(ctx, realBrand)).toBe(false);
    });

    it("workspace admin → allowed (override)", () => {
      const ctx = mkCtx({ workspaceRole: "admin" });
      expect(canCreateAsset(ctx, realBrand)).toBe(true);
    });

    it("no workspace context → denied", () => {
      const ctx = mkCtx({ workspaceRole: null });
      expect(canCreateAsset(ctx, realBrand)).toBe(false);
    });

    it("cross-workspace brand → denied even for owner", () => {
      const ctx = mkCtx({ workspaceRole: "owner" });
      const cross = mkBrand({ workspaceId: "ws-other" });
      expect(canCreateAsset(ctx, cross)).toBe(false);
    });
  });
});
