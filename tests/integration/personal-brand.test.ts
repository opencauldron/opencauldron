/**
 * Personal-brand semantics matrix (T150a / FR-006 / FR-006a / FR-006b / FR-006c).
 *
 * Pure-function tests over the policy helpers — same DB-free pattern as
 * `permissions.test.ts` and `transitions.test.ts`. The actual DB-backed
 * routes (`/api/assets/[id]/reassign-brand`, `bootstrapHostedSignup`,
 * `/api/brands/[id]` DELETE) are thin shims over these helpers.
 */

import { describe, expect, it } from "vitest";
import {
  canApprove,
  canCreateAsset,
  canDeleteBrand,
  canRejectOrArchive,
  canSubmit,
  type BrandContext,
  type BrandRole,
  type RoleContext,
  type WorkspaceRole,
} from "@/lib/workspace/permissions";
import { checkTransitionPermission } from "@/lib/transitions";

const USER_ID = "u-self";
const WS_ID = "ws-1";

function mkCtx(opts: {
  workspaceRole?: WorkspaceRole | null;
  brandRoles?: Record<string, BrandRole>;
  userId?: string;
  canGenerateVideo?: boolean;
} = {}): RoleContext {
  return {
    userId: opts.userId ?? USER_ID,
    workspace:
      opts.workspaceRole === null
        ? null
        : {
            workspaceId: WS_ID,
            role: opts.workspaceRole ?? "member",
            canGenerateVideo: opts.canGenerateVideo ?? false,
          },
    brandMemberships: new Map(Object.entries(opts.brandRoles ?? {})),
  };
}

function personalBrand(overrides: Partial<BrandContext> = {}): BrandContext {
  return {
    id: "personal-1",
    workspaceId: WS_ID,
    isPersonal: true,
    ownerId: USER_ID,
    videoEnabled: true,
    selfApprovalAllowed: false,
    ...overrides,
  };
}

function realBrand(overrides: Partial<BrandContext> = {}): BrandContext {
  return {
    id: "brand-real",
    workspaceId: WS_ID,
    isPersonal: false,
    ownerId: null,
    videoEnabled: true,
    selfApprovalAllowed: false,
    ...overrides,
  };
}

describe("Personal brand — submit-for-review (FR-006b)", () => {
  it("canSubmit returns false for the owner submitting their own draft", () => {
    const ctx = mkCtx({ brandRoles: { "personal-1": "creator" } });
    expect(
      canSubmit(ctx, { brandId: "personal-1", userId: USER_ID }, personalBrand())
    ).toBe(false);
  });

  it("canSubmit stays false even for a workspace admin", () => {
    const ctx = mkCtx({ workspaceRole: "admin" });
    expect(
      canSubmit(ctx, { brandId: "personal-1", userId: USER_ID }, personalBrand())
    ).toBe(false);
  });

  it("transition.submit returns 403 personal_brand_no_review", () => {
    const ctx = mkCtx({ brandRoles: { "personal-1": "creator" } });
    const result = checkTransitionPermission(
      "submit",
      ctx,
      { brandId: "personal-1", userId: USER_ID },
      personalBrand()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("personal_brand_no_review");
      expect(result.status).toBe(403);
    }
  });
});

describe("Personal brand — approve / reject (never enters queue)", () => {
  it("canApprove false even for self-owner", () => {
    const ctx = mkCtx({ brandRoles: { "personal-1": "brand_manager" } });
    expect(
      canApprove(ctx, { brandId: "personal-1", userId: USER_ID }, personalBrand())
    ).toBe(false);
  });

  it("canApprove false for workspace admin", () => {
    const ctx = mkCtx({ workspaceRole: "admin" });
    expect(
      canApprove(ctx, { brandId: "personal-1", userId: "u-other" }, personalBrand())
    ).toBe(false);
  });

  it("canRejectOrArchive false (the carve-out applies to reject too)", () => {
    const ctx = mkCtx({ workspaceRole: "admin" });
    expect(
      canRejectOrArchive(ctx, { brandId: "personal-1" }, personalBrand())
    ).toBe(false);
  });

  it("transition.approve / reject both return personal_brand_no_review", () => {
    const ctx = mkCtx({ workspaceRole: "admin" });
    for (const action of ["approve", "reject"] as const) {
      const r = checkTransitionPermission(
        action,
        ctx,
        { brandId: "personal-1", userId: USER_ID },
        personalBrand()
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("personal_brand_no_review");
    }
  });
});

describe("Personal brand — archive escape hatch (FR-006)", () => {
  it("owner can archive their own Personal asset even without an explicit brand_member row", () => {
    const ctx = mkCtx({ brandRoles: {} }); // no membership row
    const r = checkTransitionPermission(
      "archive",
      ctx,
      { brandId: "personal-1", userId: USER_ID },
      personalBrand()
    );
    expect(r.ok).toBe(true);
  });

  it("non-owner cannot archive someone else's Personal asset", () => {
    const ctx = mkCtx({ workspaceRole: "admin", userId: "u-other" });
    const r = checkTransitionPermission(
      "archive",
      ctx,
      { brandId: "personal-1", userId: USER_ID },
      personalBrand()
    );
    expect(r.ok).toBe(false);
  });
});

describe("Personal brand — undeletable while owner is a member (FR-006a)", () => {
  it("owner-still-member: canDeleteBrand returns false", () => {
    const ctx = mkCtx({ workspaceRole: "owner" });
    expect(canDeleteBrand(ctx, personalBrand(), true)).toBe(false);
  });

  it("owner-no-longer-member: canDeleteBrand falls back to admin/owner check", () => {
    const ctx = mkCtx({ workspaceRole: "owner" });
    expect(canDeleteBrand(ctx, personalBrand(), false)).toBe(true);
  });

  it("non-admin can never delete a Personal brand", () => {
    const ctx = mkCtx({ brandRoles: { "personal-1": "brand_manager" } });
    expect(canDeleteBrand(ctx, personalBrand(), false)).toBe(false);
  });
});

describe("Personal-brand promotion (FR-006c) — destination permission", () => {
  // The /api/assets/[id]/reassign-brand route gates on canCreateAsset for the
  // destination. The route itself enforces source-permission gating; we
  // test the destination gate here.
  it("creator+ on destination passes", () => {
    const ctx = mkCtx({ brandRoles: { "brand-real": "creator" } });
    expect(canCreateAsset(ctx, realBrand())).toBe(true);
  });

  it("viewer on destination is denied", () => {
    const ctx = mkCtx({ brandRoles: { "brand-real": "viewer" } });
    expect(canCreateAsset(ctx, realBrand())).toBe(false);
  });

  it("workspace admin can always promote into any brand", () => {
    const ctx = mkCtx({ workspaceRole: "admin" });
    expect(canCreateAsset(ctx, realBrand())).toBe(true);
  });

  it("cross-workspace destination is rejected by canCreateAsset", () => {
    const ctx = mkCtx({ workspaceRole: "admin" });
    const otherWorkspaceBrand = realBrand({ workspaceId: "ws-other" });
    expect(canCreateAsset(ctx, otherWorkspaceBrand)).toBe(false);
  });
});

describe("Personal brand — review-queue exclusion (FR-006b)", () => {
  // Note: the SQL filter lives in `/api/reviews/pending` — `eq(brands.isPersonal, false)`.
  // This test pins the contract by asserting `canApprove` always returns false on
  // Personal brands; the SQL filter is the route's belt-and-suspenders mirror.
  it("canApprove false for every (workspace role × brand role) on Personal", () => {
    const matrix: Array<[WorkspaceRole, BrandRole]> = [
      ["owner", "brand_manager"],
      ["admin", "brand_manager"],
      ["member", "brand_manager"],
      ["member", "creator"],
      ["member", "viewer"],
    ];
    for (const [wsRole, brandRole] of matrix) {
      const ctx = mkCtx({
        workspaceRole: wsRole,
        brandRoles: { "personal-1": brandRole },
      });
      expect(
        canApprove(
          ctx,
          { brandId: "personal-1", userId: "u-other" },
          personalBrand()
        )
      ).toBe(false);
    }
  });
});
