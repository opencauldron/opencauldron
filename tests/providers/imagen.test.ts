import { describe, test, expect } from "vitest";
import { generateAndSave } from "../utils/save-to-gallery";
import { getUserId } from "../utils/get-user";
import { TEST_PROMPTS } from "../utils/prompts";
import type { ModelId } from "@/types";

const MODELS: ModelId[] = [
  "imagen-4",
  "imagen-flash",
  "imagen-flash-lite",
  "imagen-4-ultra",
  "imagen-4-fast",
];

describe("Google Imagen", () => {
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
