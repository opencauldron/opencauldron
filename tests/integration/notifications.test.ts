/**
 * Notifications fan-out — pure tests for the recipient resolver.
 *
 * The recipient set for an `asset_submitted` event is the union of:
 *   * brand_members.role IN ('brand_manager')   on the asset's brand
 *   * workspace_members.role IN ('owner','admin') on the asset's workspace
 *   * minus the actor themselves (no self-pings)
 *
 * Note: the brand role enum is `brand_manager | creator | viewer` — there is
 * no `brand_admin` (the brief mentioned it but it doesn't exist in schema).
 * The pure helper here documents the actual contract.
 */

import { describe, expect, it } from "vitest";
import { resolveSubmitRecipients } from "@/lib/notifications";

describe("resolveSubmitRecipients", () => {
  const ACTOR = "actor-user";
  const MGR_A = "manager-a";
  const MGR_B = "manager-b";
  const CREATOR = "creator-user";
  const VIEWER = "viewer-user";
  const WS_OWNER = "ws-owner";
  const WS_ADMIN = "ws-admin";
  const WS_MEMBER = "ws-member";

  it("includes brand managers on the brand", () => {
    const ids = resolveSubmitRecipients({
      actorId: ACTOR,
      brandMembers: [
        { userId: MGR_A, role: "brand_manager" },
        { userId: MGR_B, role: "brand_manager" },
        { userId: CREATOR, role: "creator" },
        { userId: VIEWER, role: "viewer" },
      ],
      workspaceMembers: [],
    });
    expect(ids.sort()).toEqual([MGR_A, MGR_B].sort());
  });

  it("includes workspace owners and admins", () => {
    const ids = resolveSubmitRecipients({
      actorId: ACTOR,
      brandMembers: [],
      workspaceMembers: [
        { userId: WS_OWNER, role: "owner" },
        { userId: WS_ADMIN, role: "admin" },
        { userId: WS_MEMBER, role: "member" },
      ],
    });
    expect(ids.sort()).toEqual([WS_OWNER, WS_ADMIN].sort());
  });

  it("excludes the actor", () => {
    const ids = resolveSubmitRecipients({
      actorId: MGR_A,
      brandMembers: [
        { userId: MGR_A, role: "brand_manager" },
        { userId: MGR_B, role: "brand_manager" },
      ],
      workspaceMembers: [{ userId: MGR_A, role: "admin" }],
    });
    expect(ids).toEqual([MGR_B]);
  });

  it("dedupes a user who is both a brand_manager and workspace admin", () => {
    const ids = resolveSubmitRecipients({
      actorId: ACTOR,
      brandMembers: [{ userId: MGR_A, role: "brand_manager" }],
      workspaceMembers: [{ userId: MGR_A, role: "admin" }],
    });
    expect(ids).toEqual([MGR_A]);
  });

  it("excludes brand creators and viewers", () => {
    const ids = resolveSubmitRecipients({
      actorId: ACTOR,
      brandMembers: [
        { userId: CREATOR, role: "creator" },
        { userId: VIEWER, role: "viewer" },
      ],
      workspaceMembers: [],
    });
    expect(ids).toEqual([]);
  });

  it("returns an empty list when only the actor would be notified", () => {
    const ids = resolveSubmitRecipients({
      actorId: ACTOR,
      brandMembers: [{ userId: ACTOR, role: "brand_manager" }],
      workspaceMembers: [{ userId: ACTOR, role: "owner" }],
    });
    expect(ids).toEqual([]);
  });
});
