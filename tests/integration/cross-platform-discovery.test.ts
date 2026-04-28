/**
 * Cross-platform public-brew discovery visibility (T115a — FR-044).
 *
 * Pure-function — wraps `canBrowsePublicBrews(ctx, nonPersonalBrandCount)`.
 * No DB; the count is precomputed by the caller via
 * `countNonPersonalBrandMemberships()`. We assert the heuristic locked in
 * `specs/agency-dam-mvp/plan.md`:
 *
 *   canBrowsePublicBrews(user, workspace) =
 *     user.workspaceRole IN ('owner', 'admin')
 *     OR (user.workspaceRole = 'member'
 *         AND COUNT(brand_members WHERE is_personal=false) >= 2)
 *
 * The public/marketing path (logged-out visitors) is handled by a separate
 * route — out of scope for this helper.
 */

import { describe, expect, it } from "vitest";
import {
  canBrowsePublicBrews,
  type RoleContext,
  type WorkspaceRole,
} from "@/lib/workspace/permissions";

const WS = "ws-1";
const ME = "user-me";

function mkCtx(workspaceRole: WorkspaceRole | null): RoleContext {
  return {
    userId: ME,
    workspace:
      workspaceRole === null
        ? null
        : { workspaceId: WS, role: workspaceRole, canGenerateVideo: false },
    brandMemberships: new Map(),
  };
}

describe("canBrowsePublicBrews (FR-044)", () => {
  describe("workspace owner / admin always sees", () => {
    it("owner sees with 0 brand memberships", () => {
      expect(canBrowsePublicBrews(mkCtx("owner"), 0)).toBe(true);
    });
    it("owner sees with 1 brand membership", () => {
      expect(canBrowsePublicBrews(mkCtx("owner"), 1)).toBe(true);
    });
    it("admin sees with 0 brand memberships", () => {
      expect(canBrowsePublicBrews(mkCtx("admin"), 0)).toBe(true);
    });
    it("admin sees with 1 brand membership", () => {
      expect(canBrowsePublicBrews(mkCtx("admin"), 1)).toBe(true);
    });
  });

  describe("member heuristic — 2+ non-Personal brands", () => {
    it("member with 2 non-Personal brand memberships sees", () => {
      expect(canBrowsePublicBrews(mkCtx("member"), 2)).toBe(true);
    });
    it("member with 5 non-Personal brand memberships sees", () => {
      expect(canBrowsePublicBrews(mkCtx("member"), 5)).toBe(true);
    });
  });

  describe("member with <2 non-Personal brands hidden (client-login proxy)", () => {
    it("member with exactly 1 brand membership does NOT see", () => {
      expect(canBrowsePublicBrews(mkCtx("member"), 1)).toBe(false);
    });
    it("member with 0 brand memberships does NOT see", () => {
      expect(canBrowsePublicBrews(mkCtx("member"), 0)).toBe(false);
    });
  });

  describe("no workspace context", () => {
    it("user without a workspace_members row falls through to the count check", () => {
      // Without a workspace, isWorkspaceAdmin() is false. The function falls
      // back to the count threshold. Passing 0 should keep it hidden.
      expect(canBrowsePublicBrews(mkCtx(null), 0)).toBe(false);
    });
    it("count >= 2 still surfaces the discovery (defensive)", () => {
      // Defensive: if the loader produces a count without a workspace, the
      // helper still uses the >=2 threshold. The route layer is responsible
      // for ensuring the count only includes the requesting workspace.
      expect(canBrowsePublicBrews(mkCtx(null), 2)).toBe(true);
    });
  });
});
