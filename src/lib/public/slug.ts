import { customAlphabet } from "nanoid";

/**
 * Public-campaign slug generator.
 *
 * Mirrors the shape of `src/lib/slug.ts` but constrains the suffix alphabet to
 * `[a-z0-9]` per FR-002 — the public URL form is `/c/<brand>/<stem>-<6 chars>`
 * and we want it to look clean (no underscores, no uppercase).
 *
 * Stem rules:
 *   - lowercase
 *   - non-`[a-z0-9]+` runs collapse to `-`
 *   - leading/trailing `-` stripped
 *   - clamped to 40 chars
 *   - falls back to literal `"campaign"` when the stem is empty
 *
 * Suffix: 6 chars from `[a-z0-9]` via `customAlphabet`.
 */

const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SUFFIX_LENGTH = 6;
const STEM_MAX_LENGTH = 40;
const STEM_FALLBACK = "campaign";

const generateSuffix = customAlphabet(SUFFIX_ALPHABET, SUFFIX_LENGTH);

function deriveStem(name: string): string {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, STEM_MAX_LENGTH);

  return stem || STEM_FALLBACK;
}

/**
 * Mint a brand-new public slug for a campaign on Publish.
 *
 * The stem is derived from the campaign's current name; the suffix is a fresh
 * `nanoid(6)` from `[a-z0-9]`. Per D3, the stem is intentionally frozen at
 * Publish time and is only re-derived by the explicit Regenerate action.
 */
export function generatePublicCampaignSlug(name: string): string {
  return `${deriveStem(name)}-${generateSuffix()}`;
}

/**
 * Re-mint a public slug on the explicit Regenerate Link action.
 *
 * Behaviorally identical to `generatePublicCampaignSlug` — both re-derive the
 * stem from the current name and append a fresh suffix. They are kept as
 * separate exports because the call sites have different intent (initial
 * publish vs. invalidate-and-replace) and the spec calls them out distinctly
 * in FR-011.
 */
export function regeneratePublicCampaignSlug(name: string): string {
  return `${deriveStem(name)}-${generateSuffix()}`;
}
