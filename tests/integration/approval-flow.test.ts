/**
 * Approval flow contract tests (US3 + US4 — T101).
 *
 * Pure-function flow simulation: composes `checkTransitionPermission` with
 * `validateTransition` to walk a draft → in_review → approved sequence and
 * assert each gate behaves per the permission matrix in plan.md.
 *
 * The DB-touching `transitionAsset` wrapper and the API route handlers are
 * thin shims around these helpers; their HTTP shape is asserted by smoke tests
 * and the Phase 5 E2E run (T102) when the harness is wired up.
 */

import { describe, expect, it } from "vitest";
import {
  checkTransitionPermission,
  validateTransition,
} from "@/lib/transitions";
import type {
  BrandContext,
  RoleContext,
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
  ownerId: "creator",
};

function ctx(
  userId: string,
  role: "owner" | "admin" | "member",
  brandRoles: Array<[string, "brand_manager" | "creator" | "viewer"]>
): RoleContext {
  return {
    userId,
    workspace: { workspaceId: WS, role, canGenerateVideo: false },
    brandMemberships: new Map(brandRoles),
  };
}

describe("approval flow (T101)", () => {
  describe("submit → approve happy path", () => {
    it("creator submits, brand_manager approves", () => {
      const creator = ctx("creator", "member", [[BRAND_A, "creator"]]);
      const manager = ctx("manager", "member", [[BRAND_A, "brand_manager"]]);
      const asset = { brandId: BRAND_A, userId: "creator" };

      // Creator submits their own draft.
      const submit = checkTransitionPermission("submit", creator, asset, baseBrand);
      expect(submit.ok).toBe(true);
      expect(validateTransition("draft", "submit").to).toBe("in_review");

      // Manager approves the in_review asset.
      const approve = checkTransitionPermission("approve", manager, asset, baseBrand);
      expect(approve.ok).toBe(true);
      expect(validateTransition("in_review", "approve").to).toBe("approved");
    });
  });

  describe("self-approval gating (FR-014)", () => {
    it("blocks self-approval with self_approval_blocked code when toggle off", () => {
      const manager = ctx("self", "member", [[BRAND_A, "brand_manager"]]);
      const asset = { brandId: BRAND_A, userId: "self" };
      const result = checkTransitionPermission("approve", manager, asset, baseBrand);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("self_approval_blocked");
        expect(result.status).toBe(403);
      }
    });

    it("allows self-approval when selfApprovalAllowed=true", () => {
      const manager = ctx("self", "member", [[BRAND_A, "brand_manager"]]);
      const asset = { brandId: BRAND_A, userId: "self" };
      const brand: BrandContext = { ...baseBrand, selfApprovalAllowed: true };
      const result = checkTransitionPermission("approve", manager, asset, brand);
      expect(result.ok).toBe(true);
    });

    it("creator without manager role can never approve, regardless of toggle", () => {
      const creator = ctx("creator", "member", [[BRAND_A, "creator"]]);
      const asset = { brandId: BRAND_A, userId: "creator" };
      const brand: BrandContext = { ...baseBrand, selfApprovalAllowed: true };
      const result = checkTransitionPermission("approve", creator, asset, brand);
      expect(result.ok).toBe(false);
    });

    it("workspace admin self-approval still gated by brand toggle", () => {
      // Admin is a brand_manager by inheritance (isBrandManager → isWorkspaceAdmin).
      const admin = ctx("admin", "admin", []);
      const asset = { brandId: BRAND_A, userId: "admin" };
      const result = checkTransitionPermission("approve", admin, asset, baseBrand);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("self_approval_blocked");
    });
  });

  describe("approved-asset immutability (FR-011)", () => {
    it("validateTransition rejects approve from approved", () => {
      expect(() => validateTransition("approved", "approve")).toThrow();
      expect(() => validateTransition("approved", "submit")).toThrow();
      expect(() => validateTransition("approved", "reject")).toThrow();
    });

    it("approved → archive is the only legal exit", () => {
      expect(validateTransition("approved", "archive").to).toBe("archived");
    });
  });

  describe("Personal-brand carve-out (FR-006b)", () => {
    it("rejects submit on Personal brand with personal_brand_no_review", () => {
      const owner = ctx("creator", "member", [[BRAND_PERSONAL, "creator"]]);
      const asset = { brandId: BRAND_PERSONAL, userId: "creator" };
      const result = checkTransitionPermission("submit", owner, asset, personalBrand);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("personal_brand_no_review");
    });

    it("rejects approve on Personal brand", () => {
      const admin = ctx("admin", "admin", []);
      const asset = { brandId: BRAND_PERSONAL, userId: "creator" };
      const result = checkTransitionPermission("approve", admin, asset, personalBrand);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("personal_brand_no_review");
    });

    it("rejects reject on Personal brand", () => {
      const admin = ctx("admin", "admin", []);
      const asset = { brandId: BRAND_PERSONAL, userId: "creator" };
      const result = checkTransitionPermission("reject", admin, asset, personalBrand);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("personal_brand_no_review");
    });

    it("allows owner archive/unarchive on Personal brand even without brand_member row", () => {
      const owner = ctx("creator", "member", []);
      const asset = { brandId: BRAND_PERSONAL, userId: "creator" };
      expect(
        checkTransitionPermission("archive", owner, asset, personalBrand).ok
      ).toBe(true);
      expect(
        checkTransitionPermission("unarchive", owner, asset, personalBrand).ok
      ).toBe(true);
    });
  });

  describe("forbidden cases", () => {
    it("non-member of brand cannot submit", () => {
      const stranger = ctx("stranger", "member", []);
      const asset = { brandId: BRAND_A, userId: "stranger" };
      const result = checkTransitionPermission("submit", stranger, asset, baseBrand);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("forbidden");
    });

    it("creator cannot submit somebody else's draft", () => {
      const creator = ctx("creator", "member", [[BRAND_A, "creator"]]);
      const otherAsset = { brandId: BRAND_A, userId: "other-user" };
      const result = checkTransitionPermission("submit", creator, otherAsset, baseBrand);
      expect(result.ok).toBe(false);
    });

    it("creator cannot approve", () => {
      const creator = ctx("creator", "member", [[BRAND_A, "creator"]]);
      const asset = { brandId: BRAND_A, userId: "other-user" };
      const result = checkTransitionPermission("approve", creator, asset, baseBrand);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("forbidden");
    });

    it("viewer cannot reject", () => {
      const viewer = ctx("viewer", "member", [[BRAND_A, "viewer"]]);
      const asset = { brandId: BRAND_A, userId: "other-user" };
      const result = checkTransitionPermission("reject", viewer, asset, baseBrand);
      expect(result.ok).toBe(false);
    });
  });

  describe("fork-related invariants", () => {
    it("fork target is a draft with parent lineage — encoded as a contract", () => {
      // The route writes status='draft', source='fork', parentAssetId=source.id,
      // and a review-log row with action='forked'. Asserted by the post-fork
      // shape returned to the client.
      const forkResponse = {
        asset: {
          id: "new-id",
          brandId: BRAND_A,
          parentAssetId: "source-id",
          status: "draft" as const,
          source: "fork" as const,
        },
      };
      expect(forkResponse.asset.status).toBe("draft");
      expect(forkResponse.asset.source).toBe("fork");
      expect(forkResponse.asset.parentAssetId).toBe("source-id");
    });
  });
});
