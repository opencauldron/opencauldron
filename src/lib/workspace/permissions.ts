/**
 * Permission helpers — single source of truth for the agency-DAM access
 * model. Every API route MUST go through one of these helpers; the UI hides
 * controls based on the same helpers but the server is authoritative
 * (NFR-004).
 *
 * The pure helpers (`can*`) take a precomputed role context so they're easy
 * to unit-test. The async helpers (`assertCan*`) load context from the DB
 * and throw a `PermissionError` (with an HTTP status code) on denial.
 *
 * Role hierarchy (FR-008):
 *   Workspace Owner > Workspace Admin > (Brand Manager | Creator | Viewer)
 *   per brand. A user can hold different brand roles across brands.
 *
 * Matrix is documented in `specs/agency-dam-mvp/plan.md`.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  brandMembers,
  brands,
  workspaceMembers,
} from "@/lib/db/schema";

export type WorkspaceRole = "owner" | "admin" | "member";
export type BrandRole = "brand_manager" | "creator" | "viewer";
export type BrewVisibility = "private" | "brand" | "public";

export interface WorkspaceContext {
  workspaceId: string;
  role: WorkspaceRole;
  canGenerateVideo: boolean;
}

export interface BrandContext {
  id: string;
  workspaceId: string;
  isPersonal: boolean;
  ownerId: string | null;
  videoEnabled: boolean;
  selfApprovalAllowed: boolean;
}

export interface BrandMembership {
  brandId: string;
  role: BrandRole;
}

/** Precomputed role context for a request. */
export interface RoleContext {
  userId: string;
  workspace: WorkspaceContext | null;
  brandMemberships: Map<string, BrandRole>;
}

export class PermissionError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "PermissionError";
  }
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/**
 * Load the role context for a user in a specific workspace. If the user has
 * no `workspace_members` row the context resolves with `workspace = null` —
 * caller decides whether that's a 404 or 403.
 */
export async function loadRoleContext(
  userId: string,
  workspaceId: string
): Promise<RoleContext> {
  const memberRows = await db
    .select({
      role: workspaceMembers.role,
      canGenerateVideo: workspaceMembers.canGenerateVideo,
    })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.workspaceId, workspaceId)
      )
    )
    .limit(1);

  const wsMember = memberRows[0];
  const workspace: WorkspaceContext | null = wsMember
    ? {
        workspaceId,
        role: wsMember.role as WorkspaceRole,
        canGenerateVideo: wsMember.canGenerateVideo,
      }
    : null;

  const memberships = wsMember
    ? await db
        .select({ brandId: brandMembers.brandId, role: brandMembers.role })
        .from(brandMembers)
        .innerJoin(brands, eq(brands.id, brandMembers.brandId))
        .where(
          and(
            eq(brandMembers.userId, userId),
            eq(brands.workspaceId, workspaceId)
          )
        )
    : [];

  const brandMembershipMap = new Map<string, BrandRole>();
  for (const m of memberships) brandMembershipMap.set(m.brandId, m.role as BrandRole);

  return { userId, workspace, brandMemberships: brandMembershipMap };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Workspace owner/admin overrides every brand-scoped denial. */
export function isWorkspaceAdmin(ctx: RoleContext): boolean {
  return ctx.workspace?.role === "owner" || ctx.workspace?.role === "admin";
}

export function isWorkspaceOwner(ctx: RoleContext): boolean {
  return ctx.workspace?.role === "owner";
}

export function brandRole(ctx: RoleContext, brandId: string): BrandRole | null {
  return ctx.brandMemberships.get(brandId) ?? null;
}

/** Creator+ on the brand, OR workspace admin/owner. */
export function isBrandCreator(ctx: RoleContext, brandId: string): boolean {
  const role = brandRole(ctx, brandId);
  return (
    isWorkspaceAdmin(ctx) ||
    role === "brand_manager" ||
    role === "creator"
  );
}

/** Brand-manager on the brand, OR workspace admin/owner. */
export function isBrandManager(ctx: RoleContext, brandId: string): boolean {
  return isWorkspaceAdmin(ctx) || brandRole(ctx, brandId) === "brand_manager";
}

/** Any role at all — for read access. */
export function isBrandMember(ctx: RoleContext, brandId: string): boolean {
  return isWorkspaceAdmin(ctx) || ctx.brandMemberships.has(brandId);
}

// ---------------------------------------------------------------------------
// Permission predicates (one per matrix row)
// ---------------------------------------------------------------------------

/** FR-007 / Plan permission matrix — read access on a brand-scoped asset. */
export function canRead(ctx: RoleContext, asset: { brandId: string; userId: string }): boolean {
  if (asset.userId === ctx.userId) return true;
  return isBrandMember(ctx, asset.brandId);
}

/** Generate / upload an asset on a brand — Creator+ on brand. */
export function canCreateAsset(ctx: RoleContext, brand: BrandContext): boolean {
  if (brand.workspaceId !== ctx.workspace?.workspaceId) return false;
  return isBrandCreator(ctx, brand.id);
}

/**
 * Submit an asset for review. Creator+ on the brand AND not a Personal brand
 * (FR-006b — Personal-brand assets cannot enter the review pipeline).
 */
export function canSubmit(
  ctx: RoleContext,
  asset: { brandId: string; userId: string },
  brand: BrandContext
): boolean {
  if (brand.isPersonal) return false;
  if (asset.brandId !== brand.id) return false;
  // Creators submit only their own; brand_managers / admins submit anyone's.
  if (isBrandManager(ctx, brand.id)) return true;
  return ctx.brandMemberships.get(brand.id) === "creator" && asset.userId === ctx.userId;
}

/**
 * Approve an asset — brand_manager on the brand. Self-approval requires
 * `brand.selfApprovalAllowed=true` (FR-014).
 */
export function canApprove(
  ctx: RoleContext,
  asset: { brandId: string; userId: string },
  brand: BrandContext
): boolean {
  if (brand.isPersonal) return false;
  if (!isBrandManager(ctx, brand.id)) return false;
  if (asset.userId === ctx.userId && !brand.selfApprovalAllowed) return false;
  return true;
}

/** Reject / archive — brand_manager on the brand. */
export function canRejectOrArchive(
  ctx: RoleContext,
  asset: { brandId: string },
  brand: BrandContext
): boolean {
  if (brand.isPersonal) return false;
  return isBrandManager(ctx, brand.id);
}

/** Fork an approved asset — Creator+ on the source brand. */
export function canFork(ctx: RoleContext, brand: BrandContext): boolean {
  return isBrandCreator(ctx, brand.id);
}

/** Edit (mutate prompt/parameters) — Creator+ on the brand AND owner of asset, unless approved. */
export function canEdit(
  ctx: RoleContext,
  asset: { brandId: string; userId: string; status: string },
  brand: BrandContext
): boolean {
  // Approved is immutable (FR-011) — fork is the only path.
  if (asset.status === "approved") return false;
  if (isBrandManager(ctx, brand.id)) return true;
  return (
    ctx.brandMemberships.get(brand.id) === "creator" && asset.userId === ctx.userId
  );
}

/** Create a brand inside a workspace — owner/admin only (FR-029). */
export function canCreateBrand(ctx: RoleContext): boolean {
  return isWorkspaceAdmin(ctx);
}

/**
 * Delete a brand. Personal brands are undeletable while their owner is still
 * a workspace member (FR-006a). Real brands: workspace owner/admin only.
 */
export function canDeleteBrand(
  ctx: RoleContext,
  brand: BrandContext,
  ownerStillMember: boolean
): boolean {
  if (brand.isPersonal && ownerStillMember) return false;
  return isWorkspaceAdmin(ctx);
}

/** Edit brand kit — brand_manager+ or workspace owner/admin (FR-040). */
export function canEditBrandKit(ctx: RoleContext, brand: BrandContext): boolean {
  return isBrandManager(ctx, brand.id);
}

/**
 * Run a video brew (FR-034). Two gates:
 *   1. workspace_members.canGenerateVideo
 *   2. brand.videoEnabled (Personal brand exempt — only the per-member flag).
 * Returns a discriminating error code on denial so the API can surface it.
 */
export type VideoGateResult =
  | { allowed: true }
  | { allowed: false; code: "video_capability_denied" | "video_disabled_for_brand" };

export function canGenerateVideo(
  ctx: RoleContext,
  brand: BrandContext
): VideoGateResult {
  if (!ctx.workspace?.canGenerateVideo) {
    return { allowed: false, code: "video_capability_denied" };
  }
  if (!brand.isPersonal && !brand.videoEnabled) {
    return { allowed: false, code: "video_disabled_for_brand" };
  }
  return { allowed: true };
}

/** Invite to a brand (FR-038) — brand_manager on brand OR workspace owner/admin. */
export function canInviteToBrand(ctx: RoleContext, brand: BrandContext): boolean {
  return isBrandManager(ctx, brand.id);
}

/**
 * Remove or downgrade a brand member (FR-039). Brand_manager+ — but the LAST
 * brand_manager on the brand cannot be removed/downgraded; the API returns
 * 409 `last_brand_manager` when violated.
 */
export function canRemoveFromBrand(
  ctx: RoleContext,
  brand: BrandContext,
  target: { userId: string; role: BrandRole },
  brandManagerCount: number
): { allowed: boolean; code?: string } {
  if (!isBrandManager(ctx, brand.id)) return { allowed: false, code: "not_brand_manager" };
  // Last brand_manager guard.
  if (target.role === "brand_manager" && brandManagerCount <= 1) {
    return { allowed: false, code: "last_brand_manager" };
  }
  return { allowed: true };
}

/** Brew visibility transition gate (FR-042). */
export function canChangeBrewVisibility(
  ctx: RoleContext,
  brew: { brandId: string | null; userId: string },
  from: BrewVisibility,
  to: BrewVisibility
): boolean {
  // Promotion to public requires brand_manager+ or workspace admin/owner.
  if (to === "public") {
    if (!brew.brandId) return isWorkspaceAdmin(ctx);
    return isBrandManager(ctx, brew.brandId);
  }
  // Demotion from public uses the same editorial gate.
  if (from === "public") {
    if (!brew.brandId) return isWorkspaceAdmin(ctx);
    return isBrandManager(ctx, brew.brandId);
  }
  // private <-> brand: any creator+ on the brew's brand.
  if (!brew.brandId) {
    // Generic / community recipes — only the author can flip private<->brand
    // (and there's no brand to share into anyway). Treat as creator-equivalent.
    return brew.userId === ctx.userId || isWorkspaceAdmin(ctx);
  }
  return isBrandCreator(ctx, brew.brandId);
}

/**
 * Cross-platform public brew discovery visibility (FR-044).
 * Heuristic: workspace owner/admin OR member with brand_members rows on
 * 2+ non-Personal brands.
 */
export function canBrowsePublicBrews(
  ctx: RoleContext,
  nonPersonalBrandCount: number
): boolean {
  if (isWorkspaceAdmin(ctx)) return true;
  return nonPersonalBrandCount >= 2;
}

// ---------------------------------------------------------------------------
// Async asserts — load helpers from DB and throw on denial
// ---------------------------------------------------------------------------

export async function loadBrandContext(
  brandId: string
): Promise<BrandContext | null> {
  const rows = await db
    .select({
      id: brands.id,
      workspaceId: brands.workspaceId,
      isPersonal: brands.isPersonal,
      ownerId: brands.ownerId,
      videoEnabled: brands.videoEnabled,
      selfApprovalAllowed: brands.selfApprovalAllowed,
    })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    workspaceId: r.workspaceId ?? "",
    isPersonal: r.isPersonal,
    ownerId: r.ownerId,
    videoEnabled: r.videoEnabled,
    selfApprovalAllowed: r.selfApprovalAllowed,
  };
}

export async function countBrandManagers(brandId: string): Promise<number> {
  const rows = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(brandMembers)
    .where(
      and(
        eq(brandMembers.brandId, brandId),
        eq(brandMembers.role, "brand_manager")
      )
    );
  return rows[0]?.cnt ?? 0;
}

export async function countNonPersonalBrandMemberships(
  ctx: RoleContext
): Promise<number> {
  if (!ctx.workspace) return 0;
  const rows = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(brandMembers)
    .innerJoin(brands, eq(brands.id, brandMembers.brandId))
    .where(
      and(
        eq(brandMembers.userId, ctx.userId),
        eq(brands.workspaceId, ctx.workspace.workspaceId),
        eq(brands.isPersonal, false)
      )
    );
  return rows[0]?.cnt ?? 0;
}
