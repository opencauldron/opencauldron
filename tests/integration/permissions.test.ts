/**
 * Comprehensive permission-matrix tests (T115).
 *
 * Pure-function — exercises every exported `can*` and `is*` helper from
 * `src/lib/workspace/permissions.ts`. No DB, no integration env required.
 *
 * The matrix mirrored here is the "Permission Matrix" table in
 * `specs/agency-dam-mvp/plan.md` and the relevant FRs in `spec.md`:
 *   FR-007  brand-scoped enforcement on every mutation
 *   FR-014  brand_manager self-approval gated by selfApprovalAllowed
 *   FR-038  brand_manager can invite to their own brand
 *   FR-039  last brand_manager guard
 *   FR-040  brand_manager edits brand kit
 *   FR-041  brews.visibility enum
 *   FR-042  visibility transition gates
 *   FR-006a Personal brand undeletable while owner is workspace member
 *   FR-006b Personal brand never enters review pipeline
 *   FR-011  approved is immutable
 *   FR-034  video gate (capability + brand toggle)
 *
 * Style: pure `expect()` — no `expect.fail()`, no DB, no mocks. Each `it`
 * is one row of the matrix; assertions stay terse on purpose.
 */

import { describe, expect, it } from "vitest";
import {
  canApprove,
  canChangeBrewVisibility,
  canCreateAsset,
  canCreateBrand,
  canDeleteBrand,
  canEdit,
  canEditBrandKit,
  canFork,
  canGenerateVideo,
  canInviteToBrand,
  canRead,
  canRejectOrArchive,
  canRemoveFromBrand,
  canSubmit,
  isBrandCreator,
  isBrandManager,
  isBrandMember,
  isWorkspaceAdmin,
  isWorkspaceOwner,
  type BrandContext,
  type BrandRole,
  type BrewVisibility,
  type RoleContext,
  type WorkspaceRole,
} from "@/lib/workspace/permissions";

const WS = "ws-1";
const WS_OTHER = "ws-other";
const BRAND = "brand-a";
const BRAND_OTHER = "brand-b";
const BRAND_PERSONAL = "brand-personal";
const ME = "user-me";

function mkCtx(opts: {
  workspaceRole: WorkspaceRole | null;
  brandRoles?: Array<[string, BrandRole]>;
  userId?: string;
  canGenerateVideo?: boolean;
  workspaceId?: string;
}): RoleContext {
  return {
    userId: opts.userId ?? ME,
    workspace:
      opts.workspaceRole === null
        ? null
        : {
            workspaceId: opts.workspaceId ?? WS,
            role: opts.workspaceRole,
            canGenerateVideo: opts.canGenerateVideo ?? false,
          },
    brandMemberships: new Map(opts.brandRoles ?? []),
  };
}

function mkBrand(opts: {
  id?: string;
  workspaceId?: string;
  isPersonal?: boolean;
  videoEnabled?: boolean;
  selfApprovalAllowed?: boolean;
  ownerId?: string | null;
} = {}): BrandContext {
  return {
    id: opts.id ?? BRAND,
    workspaceId: opts.workspaceId ?? WS,
    isPersonal: opts.isPersonal ?? false,
    ownerId: opts.ownerId ?? null,
    videoEnabled: opts.videoEnabled ?? true,
    selfApprovalAllowed: opts.selfApprovalAllowed ?? false,
  };
}

const realBrand = mkBrand();
const personalBrand = mkBrand({ id: BRAND_PERSONAL, isPersonal: true, ownerId: ME });

describe("permissions matrix", () => {
  // -------------------------------------------------------------------------
  // Role predicates
  // -------------------------------------------------------------------------
  describe("isWorkspaceOwner / isWorkspaceAdmin", () => {
    it("owner is owner AND admin", () => {
      const c = mkCtx({ workspaceRole: "owner" });
      expect(isWorkspaceOwner(c)).toBe(true);
      expect(isWorkspaceAdmin(c)).toBe(true);
    });
    it("admin is admin but NOT owner", () => {
      const c = mkCtx({ workspaceRole: "admin" });
      expect(isWorkspaceOwner(c)).toBe(false);
      expect(isWorkspaceAdmin(c)).toBe(true);
    });
    it("member is neither", () => {
      const c = mkCtx({ workspaceRole: "member" });
      expect(isWorkspaceOwner(c)).toBe(false);
      expect(isWorkspaceAdmin(c)).toBe(false);
    });
    it("no workspace context = neither", () => {
      const c = mkCtx({ workspaceRole: null });
      expect(isWorkspaceOwner(c)).toBe(false);
      expect(isWorkspaceAdmin(c)).toBe(false);
    });
  });

  describe("isBrandManager / isBrandCreator / isBrandMember", () => {
    it("brand_manager → manager+creator+member true", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] });
      expect(isBrandManager(c, BRAND)).toBe(true);
      expect(isBrandCreator(c, BRAND)).toBe(true);
      expect(isBrandMember(c, BRAND)).toBe(true);
    });
    it("creator → creator+member true; manager false", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]] });
      expect(isBrandManager(c, BRAND)).toBe(false);
      expect(isBrandCreator(c, BRAND)).toBe(true);
      expect(isBrandMember(c, BRAND)).toBe(true);
    });
    it("viewer → only member true", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "viewer"]] });
      expect(isBrandManager(c, BRAND)).toBe(false);
      expect(isBrandCreator(c, BRAND)).toBe(false);
      expect(isBrandMember(c, BRAND)).toBe(true);
    });
    it("non-member of brand → all false", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND_OTHER, "creator"]] });
      expect(isBrandManager(c, BRAND)).toBe(false);
      expect(isBrandCreator(c, BRAND)).toBe(false);
      expect(isBrandMember(c, BRAND)).toBe(false);
    });
    it("workspace admin inherits manager/creator/member on every brand", () => {
      const c = mkCtx({ workspaceRole: "admin" });
      expect(isBrandManager(c, BRAND)).toBe(true);
      expect(isBrandCreator(c, BRAND)).toBe(true);
      expect(isBrandMember(c, BRAND)).toBe(true);
    });
    it("workspace owner inherits manager/creator/member on every brand", () => {
      const c = mkCtx({ workspaceRole: "owner" });
      expect(isBrandManager(c, BRAND_OTHER)).toBe(true);
      expect(isBrandCreator(c, BRAND_OTHER)).toBe(true);
      expect(isBrandMember(c, BRAND_OTHER)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // canRead — author wins, brand member sees brand assets, admin always sees
  // -------------------------------------------------------------------------
  describe("canRead", () => {
    it("creator of asset always reads (cross-brand even)", () => {
      const c = mkCtx({ workspaceRole: "member" });
      expect(canRead(c, { brandId: "anywhere", userId: ME })).toBe(true);
    });
    it("brand viewer sees other peoples' assets on the brand", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "viewer"]] });
      expect(canRead(c, { brandId: BRAND, userId: "other" })).toBe(true);
    });
    it("brand creator sees other peoples' assets on the brand", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]] });
      expect(canRead(c, { brandId: BRAND, userId: "other" })).toBe(true);
    });
    it("non-member of brand denied", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]] });
      expect(canRead(c, { brandId: BRAND_OTHER, userId: "other" })).toBe(false);
    });
    it("workspace admin always sees", () => {
      const c = mkCtx({ workspaceRole: "admin" });
      expect(canRead(c, { brandId: BRAND_OTHER, userId: "other" })).toBe(true);
    });
    it("workspace owner always sees", () => {
      const c = mkCtx({ workspaceRole: "owner" });
      expect(canRead(c, { brandId: BRAND_OTHER, userId: "other" })).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // canCreateAsset — Creator+ on brand, cross-workspace rejected
  // -------------------------------------------------------------------------
  describe("canCreateAsset", () => {
    it("creator allowed", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]] });
      expect(canCreateAsset(c, realBrand)).toBe(true);
    });
    it("brand_manager allowed", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] });
      expect(canCreateAsset(c, realBrand)).toBe(true);
    });
    it("viewer denied", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "viewer"]] });
      expect(canCreateAsset(c, realBrand)).toBe(false);
    });
    it("workspace member with no brand role denied", () => {
      const c = mkCtx({ workspaceRole: "member" });
      expect(canCreateAsset(c, realBrand)).toBe(false);
    });
    it("workspace admin allowed (override)", () => {
      const c = mkCtx({ workspaceRole: "admin" });
      expect(canCreateAsset(c, realBrand)).toBe(true);
    });
    it("workspace owner allowed (override)", () => {
      const c = mkCtx({ workspaceRole: "owner" });
      expect(canCreateAsset(c, realBrand)).toBe(true);
    });
    it("cross-workspace brand rejected even for owner", () => {
      const c = mkCtx({ workspaceRole: "owner" });
      const cross = mkBrand({ workspaceId: WS_OTHER });
      expect(canCreateAsset(c, cross)).toBe(false);
    });
    it("no workspace context rejected", () => {
      const c = mkCtx({ workspaceRole: null });
      expect(canCreateAsset(c, realBrand)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // canSubmit — FR-006b Personal rejected; creator own only; manager any
  // -------------------------------------------------------------------------
  describe("canSubmit", () => {
    it("creator submits own draft", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]] });
      expect(canSubmit(c, { brandId: BRAND, userId: ME }, realBrand)).toBe(true);
    });
    it("creator cannot submit another's draft", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]] });
      expect(canSubmit(c, { brandId: BRAND, userId: "other" }, realBrand)).toBe(false);
    });
    it("brand_manager submits anyone's", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] });
      expect(canSubmit(c, { brandId: BRAND, userId: "other" }, realBrand)).toBe(true);
    });
    it("workspace admin submits anyone's (override)", () => {
      const c = mkCtx({ workspaceRole: "admin" });
      expect(canSubmit(c, { brandId: BRAND, userId: "other" }, realBrand)).toBe(true);
    });
    it("viewer denied", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "viewer"]] });
      expect(canSubmit(c, { brandId: BRAND, userId: ME }, realBrand)).toBe(false);
    });
    it("Personal brand always rejected (FR-006b) — even for owner", () => {
      const c = mkCtx({ workspaceRole: "owner" });
      expect(canSubmit(c, { brandId: BRAND_PERSONAL, userId: ME }, personalBrand)).toBe(false);
    });
    it("brandId mismatch rejected", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] });
      expect(canSubmit(c, { brandId: BRAND_OTHER, userId: ME }, realBrand)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // canApprove — FR-014 self-approval gating
  // -------------------------------------------------------------------------
  describe("canApprove", () => {
    it("brand_manager approves another's asset", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] });
      expect(canApprove(c, { brandId: BRAND, userId: "other" }, realBrand)).toBe(true);
    });
    it("brand_manager BLOCKED on own asset when selfApprovalAllowed=false", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] });
      expect(canApprove(c, { brandId: BRAND, userId: ME }, realBrand)).toBe(false);
    });
    it("brand_manager ALLOWED on own asset when selfApprovalAllowed=true", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] });
      const brand = mkBrand({ selfApprovalAllowed: true });
      expect(canApprove(c, { brandId: BRAND, userId: ME }, brand)).toBe(true);
    });
    it("workspace admin gated by selfApprovalAllowed for own asset", () => {
      const c = mkCtx({ workspaceRole: "admin" });
      expect(canApprove(c, { brandId: BRAND, userId: ME }, realBrand)).toBe(false);
      const brand = mkBrand({ selfApprovalAllowed: true });
      expect(canApprove(c, { brandId: BRAND, userId: ME }, brand)).toBe(true);
    });
    it("creator never approves", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]] });
      expect(canApprove(c, { brandId: BRAND, userId: "other" }, realBrand)).toBe(false);
    });
    it("viewer never approves", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "viewer"]] });
      expect(canApprove(c, { brandId: BRAND, userId: "other" }, realBrand)).toBe(false);
    });
    it("Personal brand never approvable (FR-006b)", () => {
      const c = mkCtx({ workspaceRole: "owner" });
      expect(canApprove(c, { brandId: BRAND_PERSONAL, userId: "other" }, personalBrand)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // canRejectOrArchive
  // -------------------------------------------------------------------------
  describe("canRejectOrArchive", () => {
    it("brand_manager allowed", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] });
      expect(canRejectOrArchive(c, { brandId: BRAND }, realBrand)).toBe(true);
    });
    it("workspace admin allowed", () => {
      const c = mkCtx({ workspaceRole: "admin" });
      expect(canRejectOrArchive(c, { brandId: BRAND }, realBrand)).toBe(true);
    });
    it("creator denied", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]] });
      expect(canRejectOrArchive(c, { brandId: BRAND }, realBrand)).toBe(false);
    });
    it("viewer denied", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "viewer"]] });
      expect(canRejectOrArchive(c, { brandId: BRAND }, realBrand)).toBe(false);
    });
    it("Personal brand always rejected", () => {
      const c = mkCtx({ workspaceRole: "owner" });
      expect(canRejectOrArchive(c, { brandId: BRAND_PERSONAL }, personalBrand)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // canFork
  // -------------------------------------------------------------------------
  describe("canFork", () => {
    it("creator allowed", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]] });
      expect(canFork(c, realBrand)).toBe(true);
    });
    it("brand_manager allowed", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] });
      expect(canFork(c, realBrand)).toBe(true);
    });
    it("viewer denied", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "viewer"]] });
      expect(canFork(c, realBrand)).toBe(false);
    });
    it("workspace admin allowed", () => {
      const c = mkCtx({ workspaceRole: "admin" });
      expect(canFork(c, realBrand)).toBe(true);
    });
    it("non-member denied", () => {
      const c = mkCtx({ workspaceRole: "member" });
      expect(canFork(c, realBrand)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // canEdit — FR-011 approved is immutable
  // -------------------------------------------------------------------------
  describe("canEdit", () => {
    it("approved asset is immutable for everyone (FR-011)", () => {
      const approved = { brandId: BRAND, userId: ME, status: "approved" };
      expect(canEdit(mkCtx({ workspaceRole: "owner" }), approved, realBrand)).toBe(false);
      expect(canEdit(mkCtx({ workspaceRole: "admin" }), approved, realBrand)).toBe(false);
      expect(
        canEdit(mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] }), approved, realBrand)
      ).toBe(false);
    });
    it("creator edits own non-approved asset", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]] });
      expect(canEdit(c, { brandId: BRAND, userId: ME, status: "draft" }, realBrand)).toBe(true);
      expect(canEdit(c, { brandId: BRAND, userId: ME, status: "in_review" }, realBrand)).toBe(true);
      expect(canEdit(c, { brandId: BRAND, userId: ME, status: "rejected" }, realBrand)).toBe(true);
    });
    it("creator cannot edit another creator's draft", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]] });
      expect(canEdit(c, { brandId: BRAND, userId: "other", status: "draft" }, realBrand)).toBe(false);
    });
    it("brand_manager edits anyone's non-approved asset", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] });
      expect(canEdit(c, { brandId: BRAND, userId: "other", status: "draft" }, realBrand)).toBe(true);
      expect(canEdit(c, { brandId: BRAND, userId: "other", status: "in_review" }, realBrand)).toBe(true);
    });
    it("workspace admin edits anyone's non-approved asset", () => {
      const c = mkCtx({ workspaceRole: "admin" });
      expect(canEdit(c, { brandId: BRAND, userId: "other", status: "draft" }, realBrand)).toBe(true);
    });
    it("viewer never edits", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "viewer"]] });
      expect(canEdit(c, { brandId: BRAND, userId: ME, status: "draft" }, realBrand)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // canCreateBrand — FR-029 owner/admin only
  // -------------------------------------------------------------------------
  describe("canCreateBrand", () => {
    it("owner allowed", () => {
      expect(canCreateBrand(mkCtx({ workspaceRole: "owner" }))).toBe(true);
    });
    it("admin allowed", () => {
      expect(canCreateBrand(mkCtx({ workspaceRole: "admin" }))).toBe(true);
    });
    it("member denied", () => {
      expect(canCreateBrand(mkCtx({ workspaceRole: "member" }))).toBe(false);
    });
    it("no workspace context denied", () => {
      expect(canCreateBrand(mkCtx({ workspaceRole: null }))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // canDeleteBrand — FR-006a Personal undeletable while owner is member
  // -------------------------------------------------------------------------
  describe("canDeleteBrand", () => {
    it("Personal undeletable while owner still in workspace (FR-006a)", () => {
      expect(canDeleteBrand(mkCtx({ workspaceRole: "owner" }), personalBrand, true)).toBe(false);
      expect(canDeleteBrand(mkCtx({ workspaceRole: "admin" }), personalBrand, true)).toBe(false);
    });
    it("Personal deletable once owner has left workspace", () => {
      expect(canDeleteBrand(mkCtx({ workspaceRole: "admin" }), personalBrand, false)).toBe(true);
    });
    it("real brand: owner allowed", () => {
      expect(canDeleteBrand(mkCtx({ workspaceRole: "owner" }), realBrand, true)).toBe(true);
    });
    it("real brand: admin allowed", () => {
      expect(canDeleteBrand(mkCtx({ workspaceRole: "admin" }), realBrand, true)).toBe(true);
    });
    it("real brand: brand_manager denied (workspace-level only)", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] });
      expect(canDeleteBrand(c, realBrand, true)).toBe(false);
    });
    it("real brand: member denied", () => {
      expect(canDeleteBrand(mkCtx({ workspaceRole: "member" }), realBrand, true)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // canEditBrandKit — FR-040 brand_manager+
  // -------------------------------------------------------------------------
  describe("canEditBrandKit", () => {
    it("brand_manager allowed", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] });
      expect(canEditBrandKit(c, realBrand)).toBe(true);
    });
    it("workspace admin allowed", () => {
      expect(canEditBrandKit(mkCtx({ workspaceRole: "admin" }), realBrand)).toBe(true);
    });
    it("workspace owner allowed", () => {
      expect(canEditBrandKit(mkCtx({ workspaceRole: "owner" }), realBrand)).toBe(true);
    });
    it("creator denied (read-only)", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]] });
      expect(canEditBrandKit(c, realBrand)).toBe(false);
    });
    it("viewer denied (read-only)", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "viewer"]] });
      expect(canEditBrandKit(c, realBrand)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // canGenerateVideo — FR-034 (capability × videoEnabled × isPersonal)
  // -------------------------------------------------------------------------
  describe("canGenerateVideo (FR-034)", () => {
    it("capability=false on real brand → video_capability_denied", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]], canGenerateVideo: false });
      const r = canGenerateVideo(c, realBrand);
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.code).toBe("video_capability_denied");
    });
    it("capability=false on Personal → video_capability_denied (cap is the outer gate)", () => {
      const c = mkCtx({ workspaceRole: "member", canGenerateVideo: false });
      const r = canGenerateVideo(c, personalBrand);
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.code).toBe("video_capability_denied");
    });
    it("capability=true + videoEnabled=true on real brand → allowed", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]], canGenerateVideo: true });
      const r = canGenerateVideo(c, realBrand);
      expect(r.allowed).toBe(true);
    });
    it("capability=true + videoEnabled=false on real brand → video_disabled_for_brand", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]], canGenerateVideo: true });
      const r = canGenerateVideo(c, mkBrand({ videoEnabled: false }));
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.code).toBe("video_disabled_for_brand");
    });
    it("capability=true on Personal → allowed even when videoEnabled=false (Personal is exempt)", () => {
      const c = mkCtx({ workspaceRole: "member", canGenerateVideo: true });
      const r = canGenerateVideo(c, mkBrand({ id: BRAND_PERSONAL, isPersonal: true, videoEnabled: false }));
      expect(r.allowed).toBe(true);
    });
    it("no workspace context → video_capability_denied", () => {
      const c = mkCtx({ workspaceRole: null });
      const r = canGenerateVideo(c, realBrand);
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.code).toBe("video_capability_denied");
    });
  });

  // -------------------------------------------------------------------------
  // canInviteToBrand — FR-038
  // -------------------------------------------------------------------------
  describe("canInviteToBrand (FR-038)", () => {
    it("brand_manager on this brand allowed", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] });
      expect(canInviteToBrand(c, realBrand)).toBe(true);
    });
    it("brand_manager on another brand denied", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND_OTHER, "brand_manager"]] });
      expect(canInviteToBrand(c, realBrand)).toBe(false);
    });
    it("creator denied", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]] });
      expect(canInviteToBrand(c, realBrand)).toBe(false);
    });
    it("viewer denied", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "viewer"]] });
      expect(canInviteToBrand(c, realBrand)).toBe(false);
    });
    it("workspace admin allowed (override)", () => {
      expect(canInviteToBrand(mkCtx({ workspaceRole: "admin" }), realBrand)).toBe(true);
    });
    it("workspace owner allowed (override)", () => {
      expect(canInviteToBrand(mkCtx({ workspaceRole: "owner" }), realBrand)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // canRemoveFromBrand — FR-039 last-manager guard
  // -------------------------------------------------------------------------
  describe("canRemoveFromBrand (FR-039)", () => {
    it("non-manager → not_brand_manager", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]] });
      const r = canRemoveFromBrand(c, realBrand, { userId: "u", role: "creator" }, 3);
      expect(r.allowed).toBe(false);
      expect(r.code).toBe("not_brand_manager");
    });
    it("removing last brand_manager → last_brand_manager", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] });
      const r = canRemoveFromBrand(c, realBrand, { userId: "u", role: "brand_manager" }, 1);
      expect(r.allowed).toBe(false);
      expect(r.code).toBe("last_brand_manager");
    });
    it("removing one of N>1 brand_managers → allowed", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] });
      const r = canRemoveFromBrand(c, realBrand, { userId: "u", role: "brand_manager" }, 2);
      expect(r.allowed).toBe(true);
      expect(r.code).toBeUndefined();
    });
    it("removing a non-manager target by manager → allowed regardless of count", () => {
      const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] });
      const r = canRemoveFromBrand(c, realBrand, { userId: "u", role: "creator" }, 1);
      expect(r.allowed).toBe(true);
    });
    it("workspace admin can remove non-last manager", () => {
      const c = mkCtx({ workspaceRole: "admin" });
      const r = canRemoveFromBrand(c, realBrand, { userId: "u", role: "brand_manager" }, 2);
      expect(r.allowed).toBe(true);
    });
    it("workspace admin still blocked by last-manager guard", () => {
      const c = mkCtx({ workspaceRole: "admin" });
      const r = canRemoveFromBrand(c, realBrand, { userId: "u", role: "brand_manager" }, 1);
      expect(r.allowed).toBe(false);
      expect(r.code).toBe("last_brand_manager");
    });
  });

  // -------------------------------------------------------------------------
  // canChangeBrewVisibility — FR-042 every from→to combo × every role
  // -------------------------------------------------------------------------
  describe("canChangeBrewVisibility (FR-042)", () => {
    const brew = { brandId: BRAND, userId: ME };
    const transitions: Array<{ from: BrewVisibility; to: BrewVisibility; managerOnly: boolean }> = [
      { from: "private", to: "brand", managerOnly: false },
      { from: "brand", to: "private", managerOnly: false },
      { from: "brand", to: "public", managerOnly: true },
      { from: "private", to: "public", managerOnly: true },
      { from: "public", to: "brand", managerOnly: true },
      { from: "public", to: "private", managerOnly: true },
    ];

    for (const t of transitions) {
      it(`${t.from}→${t.to}: brand_manager allowed`, () => {
        const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "brand_manager"]] });
        expect(canChangeBrewVisibility(c, brew, t.from, t.to)).toBe(true);
      });

      it(`${t.from}→${t.to}: workspace admin allowed`, () => {
        const c = mkCtx({ workspaceRole: "admin" });
        expect(canChangeBrewVisibility(c, brew, t.from, t.to)).toBe(true);
      });

      it(`${t.from}→${t.to}: creator ${t.managerOnly ? "denied" : "allowed"}`, () => {
        const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "creator"]] });
        expect(canChangeBrewVisibility(c, brew, t.from, t.to)).toBe(!t.managerOnly);
      });

      it(`${t.from}→${t.to}: viewer denied`, () => {
        const c = mkCtx({ workspaceRole: "member", brandRoles: [[BRAND, "viewer"]] });
        expect(canChangeBrewVisibility(c, brew, t.from, t.to)).toBe(false);
      });
    }

    it("brewless (no brandId): only the author can flip private↔brand", () => {
      const brewNoBrand = { brandId: null, userId: ME };
      const author = mkCtx({ workspaceRole: "member" });
      const stranger = mkCtx({ workspaceRole: "member", userId: "other" });
      expect(canChangeBrewVisibility(author, brewNoBrand, "private", "brand")).toBe(true);
      expect(canChangeBrewVisibility(stranger, brewNoBrand, "private", "brand")).toBe(false);
    });

    it("brewless (no brandId): workspace admin can promote to public", () => {
      const brewNoBrand = { brandId: null, userId: "other" };
      expect(
        canChangeBrewVisibility(mkCtx({ workspaceRole: "admin" }), brewNoBrand, "brand", "public")
      ).toBe(true);
    });

    it("brewless (no brandId): non-author non-admin cannot promote to public", () => {
      const brewNoBrand = { brandId: null, userId: "other" };
      expect(
        canChangeBrewVisibility(mkCtx({ workspaceRole: "member" }), brewNoBrand, "brand", "public")
      ).toBe(false);
    });
  });
});
