/**
 * Pure-function tests for the permission helpers. No DB required.
 * Smoke-tests the matrix encoded in `src/lib/workspace/permissions.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  canApprove,
  canBrowsePublicBrews,
  canChangeBrewVisibility,
  canCreateAsset,
  canCreateBrand,
  canDeleteBrand,
  canEdit,
  canFork,
  canGenerateVideo,
  canInviteToBrand,
  canRead,
  canRejectOrArchive,
  canRemoveFromBrand,
  canSubmit,
  type BrandContext,
  type RoleContext,
} from "@/lib/workspace/permissions";

const WS = "ws-1";
const BRAND_A = "brand-a";
const BRAND_PERSONAL = "brand-personal";

const baseBrand: BrandContext = {
  id: BRAND_A,
  workspaceId: WS,
  isPersonal: false,
  ownerId: null,
  videoEnabled: true,
  selfApprovalAllowed: false,
};

const personalBrand: BrandContext = {
  ...baseBrand,
  id: BRAND_PERSONAL,
  isPersonal: true,
  ownerId: "user-creator",
};

function ctx(role: "owner" | "admin" | "member", brandRoles: Array<[string, "brand_manager" | "creator" | "viewer"]>, opts: { canGenerateVideo?: boolean; userId?: string } = {}): RoleContext {
  return {
    userId: opts.userId ?? "user-1",
    workspace: {
      workspaceId: WS,
      role,
      canGenerateVideo: opts.canGenerateVideo ?? false,
    },
    brandMemberships: new Map(brandRoles),
  };
}

describe("permission matrix", () => {
  describe("canCreateBrand", () => {
    it("allows owner/admin", () => {
      expect(canCreateBrand(ctx("owner", []))).toBe(true);
      expect(canCreateBrand(ctx("admin", []))).toBe(true);
    });
    it("denies member", () => {
      expect(canCreateBrand(ctx("member", []))).toBe(false);
    });
  });

  describe("canCreateAsset", () => {
    it("allows brand_manager and creator", () => {
      expect(canCreateAsset(ctx("member", [[BRAND_A, "brand_manager"]]), baseBrand)).toBe(true);
      expect(canCreateAsset(ctx("member", [[BRAND_A, "creator"]]), baseBrand)).toBe(true);
    });
    it("denies viewer", () => {
      expect(canCreateAsset(ctx("member", [[BRAND_A, "viewer"]]), baseBrand)).toBe(false);
    });
    it("workspace admin overrides absent brand role", () => {
      expect(canCreateAsset(ctx("admin", []), baseBrand)).toBe(true);
    });
    it("denies cross-workspace brand", () => {
      const otherBrand = { ...baseBrand, workspaceId: "ws-other" };
      expect(canCreateAsset(ctx("admin", []), otherBrand)).toBe(false);
    });
  });

  describe("canSubmit", () => {
    const asset = { brandId: BRAND_A, userId: "user-1" };
    it("allows creator on own asset", () => {
      expect(canSubmit(ctx("member", [[BRAND_A, "creator"]]), asset, baseBrand)).toBe(true);
    });
    it("denies creator on someone else's asset", () => {
      expect(canSubmit(ctx("member", [[BRAND_A, "creator"]]), { ...asset, userId: "other" }, baseBrand)).toBe(false);
    });
    it("brand_manager can submit anyone's", () => {
      expect(canSubmit(ctx("member", [[BRAND_A, "brand_manager"]]), { ...asset, userId: "other" }, baseBrand)).toBe(true);
    });
    it("REJECTS on Personal brand regardless of role (FR-006b)", () => {
      const personalAsset = { brandId: BRAND_PERSONAL, userId: "user-1" };
      expect(canSubmit(ctx("admin", [[BRAND_PERSONAL, "creator"]]), personalAsset, personalBrand)).toBe(false);
    });
  });

  describe("canApprove", () => {
    const asset = { brandId: BRAND_A, userId: "other-creator" };
    it("brand_manager approves others' assets", () => {
      expect(canApprove(ctx("member", [[BRAND_A, "brand_manager"]]), asset, baseBrand)).toBe(true);
    });
    it("self-approval BLOCKED when selfApprovalAllowed=false", () => {
      const selfAsset = { brandId: BRAND_A, userId: "user-1" };
      expect(canApprove(ctx("member", [[BRAND_A, "brand_manager"]]), selfAsset, baseBrand)).toBe(false);
    });
    it("self-approval ALLOWED when toggle on", () => {
      const selfAsset = { brandId: BRAND_A, userId: "user-1" };
      expect(canApprove(ctx("member", [[BRAND_A, "brand_manager"]]), selfAsset, { ...baseBrand, selfApprovalAllowed: true })).toBe(true);
    });
    it("Personal brand never approvable", () => {
      const personalAsset = { brandId: BRAND_PERSONAL, userId: "user-1" };
      expect(canApprove(ctx("admin", []), personalAsset, personalBrand)).toBe(false);
    });
    it("creator denied", () => {
      expect(canApprove(ctx("member", [[BRAND_A, "creator"]]), asset, baseBrand)).toBe(false);
    });
  });

  describe("canRejectOrArchive", () => {
    it("brand_manager allowed; creator denied", () => {
      expect(canRejectOrArchive(ctx("member", [[BRAND_A, "brand_manager"]]), { brandId: BRAND_A }, baseBrand)).toBe(true);
      expect(canRejectOrArchive(ctx("member", [[BRAND_A, "creator"]]), { brandId: BRAND_A }, baseBrand)).toBe(false);
    });
  });

  describe("canFork", () => {
    it("creator+ allowed", () => {
      expect(canFork(ctx("member", [[BRAND_A, "creator"]]), baseBrand)).toBe(true);
      expect(canFork(ctx("member", [[BRAND_A, "viewer"]]), baseBrand)).toBe(false);
    });
  });

  describe("canEdit", () => {
    it("approved is immutable (FR-011)", () => {
      const approved = { brandId: BRAND_A, userId: "user-1", status: "approved" };
      expect(canEdit(ctx("admin", []), approved, baseBrand)).toBe(false);
    });
    it("draft editable by author", () => {
      const draft = { brandId: BRAND_A, userId: "user-1", status: "draft" };
      expect(canEdit(ctx("member", [[BRAND_A, "creator"]]), draft, baseBrand)).toBe(true);
    });
    it("creator cannot edit another creator's draft", () => {
      const draft = { brandId: BRAND_A, userId: "other", status: "draft" };
      expect(canEdit(ctx("member", [[BRAND_A, "creator"]]), draft, baseBrand)).toBe(false);
    });
  });

  describe("canRead", () => {
    it("brand member can read brand assets", () => {
      expect(canRead(ctx("member", [[BRAND_A, "viewer"]]), { brandId: BRAND_A, userId: "x" })).toBe(true);
    });
    it("non-member denied (cross-brand)", () => {
      expect(canRead(ctx("member", [[BRAND_A, "creator"]]), { brandId: "other-brand", userId: "x" })).toBe(false);
    });
    it("author can always read own asset", () => {
      expect(canRead(ctx("member", []), { brandId: "any", userId: "user-1" })).toBe(true);
    });
  });

  describe("canDeleteBrand (Personal carve-out FR-006a)", () => {
    it("denies delete on Personal while owner is workspace member", () => {
      expect(canDeleteBrand(ctx("admin", []), personalBrand, true)).toBe(false);
    });
    it("allows delete on Personal once owner has left workspace", () => {
      expect(canDeleteBrand(ctx("admin", []), personalBrand, false)).toBe(true);
    });
    it("admin/owner can delete real brands", () => {
      expect(canDeleteBrand(ctx("owner", []), baseBrand, true)).toBe(true);
    });
    it("member denied", () => {
      expect(canDeleteBrand(ctx("member", [[BRAND_A, "brand_manager"]]), baseBrand, true)).toBe(false);
    });
  });

  describe("canGenerateVideo (FR-034)", () => {
    it("denies when capability flag off", () => {
      const r = canGenerateVideo(ctx("member", [[BRAND_A, "creator"]], { canGenerateVideo: false }), baseBrand);
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.code).toBe("video_capability_denied");
    });
    it("denies when brand video disabled", () => {
      const r = canGenerateVideo(ctx("member", [[BRAND_A, "creator"]], { canGenerateVideo: true }), { ...baseBrand, videoEnabled: false });
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.code).toBe("video_disabled_for_brand");
    });
    it("allows when both flags on", () => {
      const r = canGenerateVideo(ctx("member", [[BRAND_A, "creator"]], { canGenerateVideo: true }), baseBrand);
      expect(r.allowed).toBe(true);
    });
    it("Personal brand exempt from videoEnabled", () => {
      const r = canGenerateVideo(ctx("member", [[BRAND_PERSONAL, "creator"]], { canGenerateVideo: true }), { ...personalBrand, videoEnabled: false });
      expect(r.allowed).toBe(true);
    });
  });

  describe("canInviteToBrand (FR-038) + canRemoveFromBrand (FR-039)", () => {
    it("brand_manager can invite to their brand", () => {
      expect(canInviteToBrand(ctx("member", [[BRAND_A, "brand_manager"]]), baseBrand)).toBe(true);
    });
    it("brand_manager cannot invite to a brand they don't manage", () => {
      expect(canInviteToBrand(ctx("member", [[BRAND_A, "creator"]]), baseBrand)).toBe(false);
    });
    it("last-brand-manager guard blocks self-removal", () => {
      const r = canRemoveFromBrand(
        ctx("member", [[BRAND_A, "brand_manager"]]),
        baseBrand,
        { userId: "user-1", role: "brand_manager" },
        1
      );
      expect(r.allowed).toBe(false);
      expect(r.code).toBe("last_brand_manager");
    });
    it("can downgrade non-last manager", () => {
      const r = canRemoveFromBrand(
        ctx("member", [[BRAND_A, "brand_manager"]]),
        baseBrand,
        { userId: "user-2", role: "brand_manager" },
        2
      );
      expect(r.allowed).toBe(true);
    });
  });

  describe("canChangeBrewVisibility (FR-042)", () => {
    const brew = { brandId: BRAND_A, userId: "user-1" };
    it("private→brand by creator", () => {
      expect(
        canChangeBrewVisibility(ctx("member", [[BRAND_A, "creator"]]), brew, "private", "brand")
      ).toBe(true);
    });
    it("brand→public requires brand_manager", () => {
      expect(
        canChangeBrewVisibility(ctx("member", [[BRAND_A, "creator"]]), brew, "brand", "public")
      ).toBe(false);
      expect(
        canChangeBrewVisibility(ctx("member", [[BRAND_A, "brand_manager"]]), brew, "brand", "public")
      ).toBe(true);
    });
    it("public→brand requires brand_manager (FR-042 editorial action)", () => {
      expect(
        canChangeBrewVisibility(ctx("member", [[BRAND_A, "creator"]]), brew, "public", "brand")
      ).toBe(false);
    });
  });

  describe("canBrowsePublicBrews (FR-044 heuristic)", () => {
    it("admin always sees", () => {
      expect(canBrowsePublicBrews(ctx("admin", []), 0)).toBe(true);
    });
    it("member with 2+ brand memberships sees", () => {
      expect(canBrowsePublicBrews(ctx("member", []), 2)).toBe(true);
    });
    it("member with 1 brand membership does NOT see (client login proxy)", () => {
      expect(canBrowsePublicBrews(ctx("member", []), 1)).toBe(false);
    });
  });
});
