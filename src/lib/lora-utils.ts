import type { LoraSource } from "@/types";

export function getLoraUniqueKey(lora: { source: LoraSource; civitaiVersionId?: number; hfRepoId?: string }): string {
  return lora.source === "civitai" ? `civitai:${lora.civitaiVersionId}` : `hf:${lora.hfRepoId}`;
}

export const HF_BASE_MODEL_FILTERS: Record<string, string> = {
  "Flux.1 D": "base_model:adapter:black-forest-labs/FLUX.1-dev",
  "SDXL 1.0": "base_model:adapter:stabilityai/stable-diffusion-xl-base-1.0",
  "SD 1.5": "base_model:adapter:runwayml/stable-diffusion-v1-5",
};
