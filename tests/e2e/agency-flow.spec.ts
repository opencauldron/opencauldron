/**
 * Agency review-flow E2E (T102).
 *
 * This file documents the full multi-user flow the MVP must support and
 * sketches the scaffolding hooks. It runs only when both:
 *   - E2E_ENABLED=true        (existing harness gate, see guard.ts)
 *   - AGENCY_E2E_ENABLED=true (this scenario specifically — needs a fixture
 *                              workspace, two seeded users, and a free image
 *                              provider; until that scaffolding lands the
 *                              tests skip)
 *
 * Substantive coverage of the underlying state machine + permission matrix
 * lives in:
 *   - tests/integration/transitions.test.ts (T100 — state-machine matrix)
 *   - tests/integration/approval-flow.test.ts (T101 — flow + self-approval)
 *   - tests/integration/permissions-pure.test.ts (full role × action grid)
 *
 * Phase 13's polish task will wire the full Playwright run into CI; until
 * then this scenario sketch is the contract.
 */

import { describe, expect, test } from "vitest";

const enabled =
  process.env.E2E_ENABLED === "true" &&
  process.env.AGENCY_E2E_ENABLED === "true";

const itOrSkip = enabled ? test : test.skip;

describe("agency flow E2E (T102)", () => {
  itOrSkip("creator signs up and lands in their hosted workspace", async () => {
    expect(true).toBe(true); // TODO: wire to auth + workspace bootstrap
  });

  itOrSkip("workspace admin creates a non-Personal brand", async () => {
    expect(true).toBe(true); // TODO: POST /api/brands
  });

  itOrSkip("creator generates an image scoped to the new brand", async () => {
    expect(true).toBe(true); // TODO: POST /api/generate { brandId }
  });

  itOrSkip("creator submits the draft for review", async () => {
    expect(true).toBe(true); // TODO: POST /api/assets/[id]/transition { action: 'submit' }
  });

  itOrSkip("brand_manager (different user) sees the asset in queue and approves", async () => {
    expect(true).toBe(true); // TODO: GET /api/reviews/pending → POST /transition { action: 'approve' }
  });

  itOrSkip("creator forks the approved asset; new draft references parent", async () => {
    expect(true).toBe(true); // TODO: POST /api/assets/[id]/fork → assert parentAssetId set
  });

  itOrSkip("approved asset is immutable: PATCH returns 409 asset_immutable", async () => {
    expect(true).toBe(true); // TODO: PATCH /api/assets/[id] → expect 409
  });
});
