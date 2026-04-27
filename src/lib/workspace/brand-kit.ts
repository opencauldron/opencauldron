/**
 * Brand kit injection — the server-side step before a generation request
 * hits the provider. Adds prompt prefix/suffix, applies banned-term rejection,
 * picks a default LoRA (brand-default wins over workspace-default per FR-015a),
 * and pins anchor reference images when no `imageInput` is supplied.
 *
 * Single source of truth for FR-015 + FR-015a + FR-016. The `/api/generate`
 * route calls into this exactly once per request.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { brands, workspaces } from "@/lib/db/schema";

export interface BrandKitInput {
  workspaceId: string;
  brandId: string;
  /** Original user prompt; banned-term check runs against this. */
  prompt: string;
  parameters?: Record<string, unknown> | null;
  /** Reference image identifiers passed by the user (may be empty). */
  imageInput?: string[] | null;
  /** LoRA ids the user explicitly asked for (may be empty). */
  loras?: string[] | null;
  /** When true, the user toggled "Override brand kit" — skip injection. */
  override?: boolean;
}

export interface BrandKitOutput {
  promptFinal: string;
  parametersFinal: Record<string, unknown>;
  imageInputFinal: string[];
  lorasFinal: string[];
  brandKitOverridden: boolean;
}

export class BannedTermError extends Error {
  constructor(public matchedTerm: string) {
    super(`Prompt contains a brand-banned term: "${matchedTerm}"`);
    this.name = "BannedTermError";
  }
}

export interface KitRow {
  promptPrefix: string | null;
  promptSuffix: string | null;
  bannedTerms: string[];
  defaultLoraId: string | null;
  defaultLoraIds: string[];
  anchorReferenceIds: string[];
  workspaceDefaultLoraId: string | null;
}

async function loadKit(brandId: string, workspaceId: string): Promise<KitRow | null> {
  const rows = await db
    .select({
      brandWorkspaceId: brands.workspaceId,
      promptPrefix: brands.promptPrefix,
      promptSuffix: brands.promptSuffix,
      bannedTerms: brands.bannedTerms,
      defaultLoraId: brands.defaultLoraId,
      defaultLoraIds: brands.defaultLoraIds,
      anchorReferenceIds: brands.anchorReferenceIds,
      workspaceDefaultLoraId: workspaces.defaultLoraId,
    })
    .from(brands)
    .innerJoin(workspaces, eq(workspaces.id, brands.workspaceId))
    .where(eq(brands.id, brandId))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  if (r.brandWorkspaceId !== workspaceId) {
    // brand belongs to a different workspace — caller should never reach here.
    return null;
  }
  return {
    promptPrefix: r.promptPrefix,
    promptSuffix: r.promptSuffix,
    bannedTerms: r.bannedTerms ?? [],
    defaultLoraId: r.defaultLoraId,
    defaultLoraIds: r.defaultLoraIds ?? [],
    anchorReferenceIds: r.anchorReferenceIds ?? [],
    workspaceDefaultLoraId: r.workspaceDefaultLoraId,
  };
}

/**
 * Case-insensitive substring scan for any banned term. Returns the matched
 * term (preserving original case from the brand kit) on hit; null otherwise.
 */
export function matchBannedTerm(prompt: string, bannedTerms: string[]): string | null {
  const haystack = prompt.toLowerCase();
  for (const term of bannedTerms) {
    if (!term) continue;
    if (haystack.includes(term.toLowerCase())) return term;
  }
  return null;
}

/**
 * Pure composer — given the user's intent + a kit row, produce the final
 * values. Lifted out of `applyBrandKit` so the precedence matrix (FR-015 +
 * FR-015a + FR-016) can be exercised without the DB round-trip.
 *
 * `kit === null` means "no kit loaded" — caller decides whether that's a
 * 404 or a missing brand. We treat null the same as `override`: pass-through.
 */
export function composeKit(
  input: BrandKitInput,
  kit: KitRow | null
): BrandKitOutput {
  const userLoras = input.loras ?? [];
  const userRefs = input.imageInput ?? [];
  const baseParams = { ...(input.parameters ?? {}) };

  if (!kit || input.override) {
    return {
      promptFinal: input.prompt,
      parametersFinal: baseParams,
      imageInputFinal: userRefs,
      lorasFinal: userLoras,
      brandKitOverridden: !!input.override,
    };
  }

  // 1. Banned-term gate — runs against the ORIGINAL user prompt, before any
  //    injection. Rejection error names the matched term so user can rephrase.
  const matched = matchBannedTerm(input.prompt, kit.bannedTerms);
  if (matched) throw new BannedTermError(matched);

  // 2. Prefix/suffix injection.
  const prefix = kit.promptPrefix?.trim();
  const suffix = kit.promptSuffix?.trim();
  const promptFinal = [prefix, input.prompt.trim(), suffix].filter(Boolean).join(" ");

  // 3. LoRA precedence (FR-015a): user explicit > brand-default > workspace-default.
  let lorasFinal: string[];
  if (userLoras.length > 0) {
    lorasFinal = userLoras;
  } else if (kit.defaultLoraId) {
    lorasFinal = [kit.defaultLoraId, ...kit.defaultLoraIds.filter((l) => l !== kit.defaultLoraId)];
  } else if (kit.defaultLoraIds.length > 0) {
    lorasFinal = kit.defaultLoraIds;
  } else if (kit.workspaceDefaultLoraId) {
    lorasFinal = [kit.workspaceDefaultLoraId];
  } else {
    lorasFinal = [];
  }

  // 4. Anchor reference inclusion — silent if user provided none.
  const imageInputFinal =
    userRefs.length > 0 ? userRefs : kit.anchorReferenceIds;

  return {
    promptFinal,
    parametersFinal: baseParams,
    imageInputFinal,
    lorasFinal,
    brandKitOverridden: false,
  };
}

export async function applyBrandKit(input: BrandKitInput): Promise<BrandKitOutput> {
  const kit = await loadKit(input.brandId, input.workspaceId);
  return composeKit(input, kit);
}
