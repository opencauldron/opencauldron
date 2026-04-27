/**
 * Brew visibility transition matrix (T160a / FR-042 / FR-043 / FR-044).
 *
 * Pure-function tests over `permissions.canChangeBrewVisibility` — same
 * DB-free pattern as `transitions.test.ts`. Asserts the from→to gate per
 * role and per brand affiliation.
 */

import { describe, expect, it } from "vitest";
import {
  canChangeBrewVisibility,
  type BrandRole,
  type BrewVisibility,
  type RoleContext,
  type WorkspaceRole,
} from "@/lib/workspace/permissions";

const USER_ID = "u-self";
const WS_ID = "ws-1";
const BRAND_ID = "brand-1";

function mkCtx(opts: {
  workspaceRole?: WorkspaceRole | null;
  brandRoles?: Record<string, BrandRole>;
  userId?: string;
} = {}): RoleContext {
  return {
    userId: opts.userId ?? USER_ID,
    workspace:
      opts.workspaceRole === null
        ? null
        : {
            workspaceId: WS_ID,
            role: opts.workspaceRole ?? "member",
            canGenerateVideo: false,
          },
    brandMemberships: new Map(Object.entries(opts.brandRoles ?? {})),
  };
}

function brew(overrides: { brandId?: string | null; userId?: string } = {}) {
  return {
    brandId: overrides.brandId === undefined ? BRAND_ID : overrides.brandId,
    userId: overrides.userId ?? USER_ID,
  };
}

const ALL: BrewVisibility[] = ["private", "brand", "public"];

describe("canChangeBrewVisibility — private ↔ brand (FR-042)", () => {
  it("creator on the brew's brand can flip private↔brand both ways", () => {
    const ctx = mkCtx({ brandRoles: { [BRAND_ID]: "creator" } });
    expect(canChangeBrewVisibility(ctx, brew(), "private", "brand")).toBe(true);
    expect(canChangeBrewVisibility(ctx, brew(), "brand", "private")).toBe(true);
  });

  it("brand_manager can flip private↔brand", () => {
    const ctx = mkCtx({ brandRoles: { [BRAND_ID]: "brand_manager" } });
    expect(canChangeBrewVisibility(ctx, brew(), "private", "brand")).toBe(true);
  });

  it("viewer cannot flip private→brand", () => {
    const ctx = mkCtx({ brandRoles: { [BRAND_ID]: "viewer" } });
    expect(canChangeBrewVisibility(ctx, brew(), "private", "brand")).toBe(false);
  });

  it("non-member cannot flip private→brand", () => {
    const ctx = mkCtx({});
    expect(canChangeBrewVisibility(ctx, brew(), "private", "brand")).toBe(false);
  });

  it("workspace admin always allowed regardless of brand role", () => {
    const ctx = mkCtx({ workspaceRole: "admin" });
    expect(canChangeBrewVisibility(ctx, brew(), "private", "brand")).toBe(true);
    expect(canChangeBrewVisibility(ctx, brew(), "brand", "private")).toBe(true);
  });
});

describe("canChangeBrewVisibility — promote to public (FR-042)", () => {
  it("brand_manager+ can promote brand→public", () => {
    const ctx = mkCtx({ brandRoles: { [BRAND_ID]: "brand_manager" } });
    expect(canChangeBrewVisibility(ctx, brew(), "brand", "public")).toBe(true);
  });

  it("creator alone CANNOT promote brand→public", () => {
    const ctx = mkCtx({ brandRoles: { [BRAND_ID]: "creator" } });
    expect(canChangeBrewVisibility(ctx, brew(), "brand", "public")).toBe(false);
    expect(canChangeBrewVisibility(ctx, brew(), "private", "public")).toBe(
      false
    );
  });

  it("workspace owner / admin always allowed", () => {
    const owner = mkCtx({ workspaceRole: "owner" });
    const admin = mkCtx({ workspaceRole: "admin" });
    expect(canChangeBrewVisibility(owner, brew(), "brand", "public")).toBe(true);
    expect(canChangeBrewVisibility(admin, brew(), "brand", "public")).toBe(true);
  });
});

describe("canChangeBrewVisibility — demotion from public (FR-042)", () => {
  it("uses the same editorial gate (brand_manager+ or workspace admin)", () => {
    const mgr = mkCtx({ brandRoles: { [BRAND_ID]: "brand_manager" } });
    const creator = mkCtx({ brandRoles: { [BRAND_ID]: "creator" } });
    const admin = mkCtx({ workspaceRole: "admin" });

    for (const target of ["brand", "private"] as BrewVisibility[]) {
      expect(canChangeBrewVisibility(mgr, brew(), "public", target)).toBe(true);
      expect(canChangeBrewVisibility(admin, brew(), "public", target)).toBe(true);
      expect(canChangeBrewVisibility(creator, brew(), "public", target)).toBe(
        false
      );
    }
  });
});

describe("canChangeBrewVisibility — brewless / community recipe", () => {
  // Brews with no brandId are community recipes — only the author or workspace
  // admin can flip private↔brand. Promotion/demotion to public is admin-only.
  it("author alone can flip private↔brand on a brewless brew", () => {
    const ctx = mkCtx({});
    const noBrand = brew({ brandId: null, userId: USER_ID });
    expect(canChangeBrewVisibility(ctx, noBrand, "private", "brand")).toBe(true);
  });

  it("non-author non-admin cannot touch a brewless brew", () => {
    const ctx = mkCtx({ userId: "u-other" });
    const noBrand = brew({ brandId: null, userId: USER_ID });
    expect(canChangeBrewVisibility(ctx, noBrand, "private", "brand")).toBe(false);
  });

  it("workspace admin can promote a brewless brew to public", () => {
    const admin = mkCtx({ workspaceRole: "admin", userId: "u-other" });
    const noBrand = brew({ brandId: null, userId: USER_ID });
    expect(canChangeBrewVisibility(admin, noBrand, "brand", "public")).toBe(true);
  });

  it("non-author non-admin cannot promote a brewless brew to public", () => {
    const ctx = mkCtx({ userId: "u-other" });
    const noBrand = brew({ brandId: null, userId: USER_ID });
    expect(canChangeBrewVisibility(ctx, noBrand, "brand", "public")).toBe(false);
  });
});

describe("canChangeBrewVisibility — exhaustive matrix smoke", () => {
  // Ensures every (from, to) pair has a deterministic answer for the
  // five-role baseline. The point is to flag any unexpected `undefined` or
  // throw rather than to assert each cell — that's covered above.
  const roles: WorkspaceRole[] = ["owner", "admin", "member"];
  const brandRoles: BrandRole[] = ["brand_manager", "creator", "viewer"];

  for (const wsRole of roles) {
    for (const brandRole of brandRoles) {
      for (const from of ALL) {
        for (const to of ALL) {
          if (from === to) continue;
          it(`returns boolean for ${wsRole}/${brandRole} ${from}→${to}`, () => {
            const ctx = mkCtx({
              workspaceRole: wsRole,
              brandRoles: { [BRAND_ID]: brandRole },
            });
            const result = canChangeBrewVisibility(ctx, brew(), from, to);
            expect(typeof result).toBe("boolean");
          });
        }
      }
    }
  }
});
