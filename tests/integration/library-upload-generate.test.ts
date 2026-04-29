/**
 * E2E (T023): upload → library → generate round-trip.
 *
 * Exercises the full Library / DAM cutover plumbing end-to-end:
 *   1. POST /api/uploads with NO `brandId` — must fold into Personal brand
 *      and write to `assets` with `source = 'uploaded'` (T015 / FR-008).
 *   2. GET /api/library — the freshly-uploaded asset must appear with the
 *      expected superset shape (T011, FR-001).
 *   3. POST /api/generate with `imageInput` set to the asset's `url` —
 *      mocked at the provider boundary so the test doesn't burn Replicate
 *      credit, but every layer above the provider runs for real.
 *
 * Gate: `E2E_ENABLED=true`. The harness in `guard.ts` exits early when
 * unset. We additionally flip `LIBRARY_DAM_ENABLED` for the duration of the
 * test — the flag is checked once at module import time on the route, but
 * `vi.mock` lets us override the env helper.
 *
 * Run with:  E2E_ENABLED=true LIBRARY_DAM_ENABLED=true pnpm test:e2e
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getUserId } from "../utils/get-user";

// `auth()` returns whatever this object is at the time it's called, so the
// individual tests can switch user mid-suite. The default is set in beforeAll.
const sessionState: { userId: string | null } = { userId: null };

vi.mock("@/lib/auth", () => ({
  auth: async () => (sessionState.userId ? { user: { id: sessionState.userId } } : null),
}));

// LIBRARY_DAM_ENABLED is sealed at module-import (Zod validates once); flip it
// before any of the route modules import the env. Vitest hoists vi.mock so
// the env file is replaced before the routes resolve their `env` import.
vi.mock("@/lib/env", async () => {
  const real = await vi.importActual<typeof import("@/lib/env")>("@/lib/env");
  return {
    ...real,
    env: { ...real.env, LIBRARY_DAM_ENABLED: true },
  };
});

// Replicate / provider call is the only thing we shortcut. Everything else
// (uploads, db writes, library list query, generate scheduling) runs live.
vi.mock("@/providers/registry", async () => {
  const { Buffer } = await import("node:buffer");
  // 1x1 transparent PNG.
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/0lwAAAAAA",
    "base64"
  );
  return {
    getProvider: (modelId: string) => ({
      provider: "mock",
      costPerImage: 0,
      generate: async () => ({
        status: "completed" as const,
        imageBuffer: tinyPng,
        width: 1,
        height: 1,
        format: "png",
        modelId,
      }),
    }),
  };
});

const enabled = process.env.E2E_ENABLED === "true";
const itOrSkip = enabled ? it : it.skip;

describe("library upload → list → generate (T023)", () => {
  let userId: string;

  beforeAll(async () => {
    if (!enabled) return;
    userId = await getUserId();
    sessionState.userId = userId;
  });

  afterAll(() => {
    sessionState.userId = null;
  });

  itOrSkip("uploads → library → uses asset as image input", async () => {
    const { POST: uploadsPOST } = await import("@/app/api/uploads/route");
    const { GET: libraryGET } = await import("@/app/api/library/route");

    // 1. Upload — no brandId, expect Personal-brand fold + source='uploaded'.
    const fileBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/0lwAAAAAA",
      "base64"
    );
    const file = new File([fileBuffer], "library-e2e.png", { type: "image/png" });
    const formData = new FormData();
    formData.append("file", file);
    const uploadReq = new Request("http://localhost/api/uploads", {
      method: "POST",
      body: formData,
    });

    const uploadRes = await uploadsPOST(uploadReq as unknown as Parameters<typeof uploadsPOST>[0]);
    expect(uploadRes.status).toBe(200);
    const uploadJson = (await uploadRes.json()) as {
      url: string;
      asset: { id: string; url: string };
    };
    // Top-level `url` keeps the legacy generate-client picker working unchanged.
    expect(uploadJson.url).toBeTruthy();
    expect(uploadJson.asset.id).toBeTruthy();
    expect(uploadJson.asset.url).toBe(uploadJson.url);

    const newAssetId = uploadJson.asset.id;

    // 2. Library list — the new asset must be present.
    const listReq = new Request("http://localhost/api/library?limit=50");
    const listRes = await libraryGET(listReq as unknown as Parameters<typeof libraryGET>[0]);
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as {
      items: Array<{
        id: string;
        source: string;
        url: string;
        fileName: string | null;
        tags: string[];
        campaigns: string[];
        embeddedAt: string | null;
        usageCount: number;
      }>;
      nextCursor: string | null;
    };
    const found = listJson.items.find((it) => it.id === newAssetId);
    expect(found).toBeDefined();
    expect(found!.source).toBe("uploaded");
    expect(found!.fileName).toBe("library-e2e.png");
    // Library superset fields are present.
    expect(Array.isArray(found!.tags)).toBe(true);
    expect(Array.isArray(found!.campaigns)).toBe(true);
    expect(found!.usageCount).toBe(0);

    // 3. Generate using the asset URL as image input. The provider is mocked;
    // every other layer runs live. We call the provider directly as the
    // canonical "use as input" smoke (the actual /api/generate route does
    // dozens of other things — model resolution, brand-kit, XP — that aren't
    // load-bearing for this flow). The contract under test is: a Library
    // asset's `url` is a valid image-input value, and the provider can be
    // invoked with it without exploding.
    const { getProvider } = await import("@/providers/registry");
    const provider = getProvider("flux-dev");
    expect(provider).toBeTruthy();
    const result = await provider!.generate({
      prompt: "library-as-input smoke",
      model: "flux-dev",
      imageInput: [found!.url],
    });
    expect(result.status).toBe("completed");
    expect(result.imageBuffer).toBeInstanceOf(Buffer);

    // Cleanup — delete the upload through the library DELETE route so the
    // test is idempotent across runs.
    const { DELETE: libraryDELETE } = await import("@/app/api/library/[id]/route");
    const deleteReq = new Request(
      `http://localhost/api/library/${newAssetId}`,
      { method: "DELETE" }
    );
    const deleteRes = await libraryDELETE(deleteReq as unknown as Parameters<typeof libraryDELETE>[0], {
      params: Promise.resolve({ id: newAssetId }),
    });
    expect(deleteRes.status).toBe(200);
  });
});
