---
name: integrate-provider
description: "Integrate a new AI model provider (image or video) into OpenCauldron. Use this skill whenever the user asks to add a new provider, integrate a new model, add a new AI API, or connect a new image/video generation service. Also trigger when the user mentions provider names like 'Stability AI', 'Leonardo', 'Midjourney API', 'DALL-E', 'Pika', 'Kling', 'Sora', etc. and wants to add them to the platform. Covers the full lifecycle: fetching API docs, implementing the provider, registering it, wiring up the route, and running e2e tests."
---

# Integrate Provider

This skill guides you through adding a new AI model provider (image or video generation) to OpenCauldron. The codebase has a clean provider architecture — every provider follows the same interface, registration pattern, and test structure. Your job is to replicate that pattern precisely for the new provider.

## Overview

Adding a provider touches these files (in order):

1. **`src/types/index.ts`** — Add ModelId(s) and optionally a new ProviderName
2. **`src/providers/{provider}.ts`** — Implement the GenerationProvider interface
3. **`src/providers/registry.ts`** — Register provider(s), add API key check, add variant groups
4. **`src/app/api/generate/route.ts`** — Add model ID(s) to the Zod validation enum
5. **`src/app/(dashboard)/generate/generate-client.tsx`** — Add logo/icon mapping
6. **`public/logos/{vendor}.png`** — Add provider logo (image providers)
7. **`.env.example`** — Document the API key
8. **`tests/utils/prompts.ts`** — Add test prompt configs
9. **`tests/e2e/providers/{provider}.test.ts`** — Create the e2e test file

## Step 0: Research the provider's API

Before writing any code, fetch the provider's official API documentation. Use WebFetch or WebSearch to find:

- The API endpoint(s) for generation
- Authentication method (usually Bearer token)
- Request body schema (required and optional fields)
- Response format (base64 image? URL? async job ID?)
- Whether generation is **synchronous** (returns the image immediately) or **asynchronous** (returns a job ID you poll)
- Supported parameters: aspect ratios, styles, seeds, guidance, etc.
- Pricing per generation
- Rate limits

Read `references/provider-spec.md` for the exact TypeScript interfaces you'll need to implement, and `references/patterns.md` for annotated examples of both sync and async providers.

If the provider has multiple model variants (e.g., standard + pro, or different model versions), note each variant's model name, pricing, and capability differences.

## Step 1: Add types (`src/types/index.ts`)

Add model ID(s) to the `ModelId` union type. Use lowercase kebab-case that matches how the provider names their models:

```typescript
export type ModelId =
  // ... existing models ...
  | "new-model-id"
  | "new-model-id-pro";  // if variants exist
```

If this is a brand new vendor (not an existing ProviderName), add it to the `ProviderName` union too:

```typescript
export type ProviderName =
  // ... existing providers ...
  | "newvendor";
```

Add any new capability fields to `ModelCapabilities` only if the provider supports something no existing provider does. This is rare — most capabilities are already covered.

## Step 2: Implement the provider (`src/providers/{provider}.ts`)

Create the provider file. Read `references/patterns.md` for complete annotated examples.

Key rules:

- **Import only from `@/types`** — the provider file should be self-contained
- **Use a factory function** (`createGenerate(variantId)`) when you have multiple variants that share logic
- **Map aspect ratios to pixel dimensions** in a `ASPECT_RATIO_DIMENSIONS` record at the top
- **Check for the API key** at the start of `generate()` and return a failed result (don't throw)
- **Always track timing** — capture `startTime = Date.now()` and include `durationMs` in every return path
- **Use `params.enhancedPrompt ?? params.prompt`** as the prompt sent to the API (the enhanced prompt comes from the prompt improver and should be preferred when available)
- **Parse error responses carefully** — try to extract a meaningful message from the API error body
- **Export each variant as a named `GenerationProvider` object** (e.g., `export const myProvider: GenerationProvider = { ... }`)

### Sync providers (image)

Return `{ status: "completed", imageBuffer, width, height, durationMs }` on success. The image must be a `Buffer` — if the API returns base64, decode it with `Buffer.from(b64, "base64")`. If the API returns a URL, fetch it and return the buffer.

### Async providers (video, some image)

Return `{ status: "processing", jobId, durationMs }` from `generate()`. Implement `getStatus(jobId)` that polls the provider's status endpoint and returns the final result when ready. Video results use `videoUrl` (a URL the system will download) rather than a buffer.

## Step 3: Register in the registry (`src/providers/registry.ts`)

Three things to do:

### 3a. Import and add to `allProviders`

```typescript
import { myProvider, myProProvider } from "./my-provider";

const allProviders: GenerationProvider[] = [
  // ... existing providers ...
  // Add under the appropriate section comment (Image or Video)
  myProvider,
  myProProvider,
];
```

### 3b. Add variant-only IDs to `VARIANT_ONLY_IDS`

If a model is a variant of another (e.g., "pro" variant of a base model), add it so it doesn't get its own card in the UI:

```typescript
const VARIANT_ONLY_IDS: Set<ModelId> = new Set([
  // ... existing ...
  "my-model-pro",  // shown as variant, not its own card
]);
```

### 3c. Add variant group to `VARIANT_GROUPS`

If the provider has variants, define the group:

```typescript
const VARIANT_GROUPS: Partial<Record<ModelId, ModelVariant[]>> = {
  // ... existing ...
  "my-model": [
    {
      id: "my-model",
      label: "Standard",
      costPerImage: 0.04,
      avgGenerationTime: 8,
      description: "High-quality generation.",
    },
    {
      id: "my-model-pro",
      label: "Pro",
      costPerImage: 0.08,
      avgGenerationTime: 12,
      description: "Premium quality with higher resolution.",
    },
  ],
};
```

### 3d. Add API key check to `hasApiKey()`

```typescript
function hasApiKey(provider: GenerationProvider): boolean {
  switch (provider.provider) {
    // ... existing cases ...
    case "newvendor":
      return !!process.env.NEW_VENDOR_API_KEY;
    default:
      return false;
  }
}
```

### 3e. Add model description and generation time

Add entries to both `getModelDescription()` and `getAvgGenTime()` for every new model ID.

## Step 4: Wire up the generate route (`src/app/api/generate/route.ts`)

Add the new model ID(s) to the `generateSchema` Zod enum. Place them in the correct section (image or video):

```typescript
const generateSchema = z.object({
  // ...
  model: z.enum([
    // Image models
    // ... existing ...
    "my-model",
    "my-model-pro",
    // Video models
    // ... existing ...
  ]),
  // ...
});
```

If the provider uses new parameters not already in the schema, add them to `GenerationParams` in types and to the Zod schema here.

## Step 5: Add provider logo and UI mapping

The generate page auto-renders model cards from the registry (capabilities drive which parameter controls appear), but two hardcoded mappings in `src/app/(dashboard)/generate/generate-client.tsx` need updating:

### 5a. Model logo (image providers)

Add an entry to `MODEL_LOGOS` at the top of `generate-client.tsx`. Only the primary model ID needs a logo — variants inherit their parent's:

```typescript
const MODEL_LOGOS: Record<string, string> = {
  // ... existing ...
  "my-model": "/logos/myvendor.png",
};
```

Then add the logo image file to `public/logos/`. Use a square PNG with a transparent background, roughly 64x64px. You can usually find the vendor's logo on their website or press kit — download it and save it to that directory.

### 5b. Model icon (video providers)

Video providers don't use logo images — they use emoji fallbacks in `MODEL_ICONS`:

```typescript
const MODEL_ICONS: Record<string, string> = {
  // ... existing ...
  "my-video-model": "🎬",
};
```

### What the UI handles automatically

Everything else is capability-driven — no frontend code changes needed for:
- Model card display and selection (from `getAvailableModels()`)
- Variant selector tabs (from `VARIANT_GROUPS` in registry)
- Parameter controls like aspect ratio, seed, guidance, styles (from `ModelCapabilities` flags)
- Video-specific controls like duration, camera, audio (from capability flags)
- Cost and generation time display (from registry metadata)
- Provider visibility based on API key presence

## Step 6: Document the env var (`.env.example`)

Add the API key with a comment pointing to where to get it:

```
NEW_VENDOR_API_KEY=        # https://newvendor.com/api-keys
```

## Step 7: Add test prompts (`tests/utils/prompts.ts`)

Add a `TestPromptConfig` for each model variant. The prompts should be cauldron-themed (magical cauldrons, potions, alchemist vibes) to match the existing test suite aesthetic. Set realistic timeouts based on the provider's generation speed:

```typescript
"my-model": {
  prompt: "A [cauldron-themed prompt matching the model's strengths]...",
  aspectRatio: "16:9",
  timeoutMs: 30_000,
},
```

## Step 8: Create the e2e test (`tests/e2e/providers/{provider}.test.ts`)

Follow this exact pattern:

```typescript
import { describe, test, expect } from "vitest";
import { generateAndSave } from "../../utils/save-to-gallery";
import { getUserId } from "../../utils/get-user";
import { TEST_PROMPTS } from "../../utils/prompts";
import type { ModelId } from "@/types";

const MODELS: ModelId[] = ["my-model", "my-model-pro"];

describe("Provider Name", () => {
  for (const modelId of MODELS) {
    const config = TEST_PROMPTS[modelId];

    test(
      `${modelId} generates and saves to gallery`,
      async () => {
        const userId = await getUserId();
        const result = await generateAndSave({
          modelId,
          prompt: config.prompt,
          userId,
          aspectRatio: config.aspectRatio,
        });

        expect(result.assetId).toBeTruthy();
        expect(result.generationId).toBeTruthy();
        expect(result.url).toBeTruthy();
        expect(result.width).toBeGreaterThan(0);
        expect(result.height).toBeGreaterThan(0);
        expect(result.durationMs).toBeGreaterThan(0);

        console.log(
          `  ✓ [${modelId}] ${result.width}x${result.height} in ${(result.durationMs / 1000).toFixed(1)}s`
        );
      },
      config.timeoutMs
    );
  }
});
```

Note: tests use `test()` not `test.skip()` — the e2e guard handles gating via `E2E_ENABLED=true`.

## Step 9: Run e2e tests

Run the tests to verify the integration works end-to-end:

```bash
E2E_ENABLED=true npx vitest run --config vitest.e2e.config.ts tests/e2e/providers/{provider}.test.ts
```

This calls the real API, generates media, uploads to R2, and writes to the database. Each run costs real money, so run only the specific provider test file.

If tests fail, read the error output carefully — common issues:
- Wrong API endpoint URL
- Incorrect request body format (check the API docs you fetched in Step 0)
- Missing or wrong authentication header format
- Aspect ratio format mismatch (some APIs want "16:9", others want "16_9" or separate width/height)
- Response parsing issues (check if the API returns the image differently than expected)

## Verification checklist

Before considering the integration complete, verify:

- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)
- [ ] The provider appears in the UI when its API key is set (check `getAvailableProviders()`)
- [ ] The provider is hidden when its API key is not set
- [ ] Provider logo renders on the model card (image providers) or icon shows (video providers)
- [ ] Variant selector works if the provider has multiple variants
- [ ] Capability-driven parameter controls display correctly (styles, seed, guidance, etc.)
- [ ] E2E test passes for all model variants
- [ ] All variant-only models are correctly hidden from the card list but accessible by ID
- [ ] Cost estimates are accurate per the provider's pricing page
- [ ] Error handling returns meaningful messages (test with an invalid API key)

## Important conventions

- **No org-specific names** in any code, comments, or commit messages — this is a public open source repo
- **Don't throw errors** from provider `generate()` — always return a `GenerationResult` with `status: "failed"` and an `error` message
- **Follow the existing naming patterns** — look at how similar providers name their exports and model IDs
- **Keep the provider file self-contained** — all API interaction logic lives in the provider file, not spread across the codebase
