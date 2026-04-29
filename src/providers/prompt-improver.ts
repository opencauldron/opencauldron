import type { ModelId, PromptTemplate } from "@/types";

// ============================================================
// Template Mode - structured prompt modifiers
// ============================================================

export const promptModifiers = {
  style: [
    { label: "None", value: "" },
    { label: "Photorealistic", value: "photorealistic, ultra realistic" },
    { label: "Cinematic", value: "cinematic, movie still, film grain" },
    { label: "Anime", value: "anime style, cel-shaded" },
    { label: "Illustration", value: "digital illustration, detailed artwork" },
    { label: "3D Render", value: "3D render, octane render, unreal engine" },
    { label: "Oil Painting", value: "oil painting, canvas texture, painterly" },
    { label: "Watercolor", value: "watercolor painting, soft edges, flowing colors" },
    { label: "Pixel Art", value: "pixel art, retro, 8-bit" },
    { label: "Comic Book", value: "comic book style, bold outlines, vibrant" },
    { label: "Minimalist", value: "minimalist, clean, simple" },
    { label: "Surreal", value: "surrealist, dreamlike, Salvador Dali inspired" },
  ],
  lighting: [
    { label: "None", value: "" },
    { label: "Natural", value: "natural lighting" },
    { label: "Studio", value: "studio lighting, professional" },
    { label: "Dramatic", value: "dramatic lighting, chiaroscuro" },
    { label: "Golden Hour", value: "golden hour, warm sunlight" },
    { label: "Neon", value: "neon lighting, cyberpunk glow" },
    { label: "Backlit", value: "backlit, rim lighting, silhouette" },
    { label: "Soft", value: "soft diffused lighting, overcast" },
    { label: "High Key", value: "high key lighting, bright, airy" },
    { label: "Low Key", value: "low key lighting, moody, shadows" },
  ],
  composition: [
    { label: "None", value: "" },
    { label: "Close-up", value: "close-up shot, detailed" },
    { label: "Wide Angle", value: "wide angle shot, expansive view" },
    { label: "Bird's Eye", value: "bird's eye view, top-down" },
    { label: "Low Angle", value: "low angle shot, looking up" },
    { label: "Symmetrical", value: "symmetrical composition, centered" },
    { label: "Rule of Thirds", value: "rule of thirds composition" },
    { label: "Macro", value: "macro photography, extreme close-up" },
    { label: "Panoramic", value: "panoramic view, wide landscape" },
    { label: "Portrait", value: "portrait framing, shallow depth of field" },
  ],
  mood: [
    { label: "None", value: "" },
    { label: "Vibrant", value: "vibrant colors, saturated, energetic" },
    { label: "Moody", value: "moody atmosphere, dark tones" },
    { label: "Ethereal", value: "ethereal, dreamy, mystical" },
    { label: "Dark", value: "dark, ominous, brooding" },
    { label: "Warm", value: "warm tones, cozy, inviting" },
    { label: "Cool", value: "cool tones, blue, calm" },
    { label: "Nostalgic", value: "nostalgic, vintage, retro feel" },
    { label: "Futuristic", value: "futuristic, sci-fi, high-tech" },
    { label: "Whimsical", value: "whimsical, playful, fantasy" },
  ],
  quality: [
    { label: "None", value: "" },
    { label: "4K Ultra HD", value: "4K, ultra HD, ultra detailed" },
    { label: "Sharp Focus", value: "sharp focus, high resolution, crisp" },
    { label: "Professional", value: "professional photography, award-winning" },
    { label: "Masterpiece", value: "masterpiece, best quality, highly detailed" },
  ],
};

/**
 * Apply template modifiers to a base prompt.
 */
export function applyTemplateModifiers(
  basePrompt: string,
  template: PromptTemplate
): string {
  const modifiers: string[] = [];

  for (const [category, value] of Object.entries(template)) {
    if (!value) continue;
    const options =
      promptModifiers[category as keyof typeof promptModifiers];
    if (!options) continue;
    const option = options.find((o) => o.value === value);
    if (option && option.value) {
      modifiers.push(option.value);
    }
  }

  if (modifiers.length === 0) return basePrompt;
  return `${basePrompt}, ${modifiers.join(", ")}`;
}

// ============================================================
// LLM Mode - Mistral-powered prompt enhancement
// ============================================================

const MODEL_TIPS: Partial<Record<ModelId, string>> = {
  "imagen-4":
    "Imagen 4 excels at photorealistic images. Be descriptive about scene, subjects, and environment.",
  "grok-imagine":
    "Grok Imagine is creative and fast. Good with stylistic and artistic prompts.",
  "flux-1.1-pro":
    "Flux produces high quality images. Detailed, specific prompts work best.",
  "ideogram-3":
    "Ideogram 3 is the best at rendering text in images. Specify text in quotes.",
  "recraft-v3":
    "Recraft V3 excels at design, vector art, and brand-safe imagery. Great for icons and illustrations.",
  "veo-3":
    "Veo 3 generates video with native audio. Describe the scene, motion, and sounds.",
  "runway-gen4-turbo":
    "Runway Gen-4 excels at cinematic video. Describe camera movement and scene composition.",
  "kling-2.1":
    "Kling 2.1 has excellent motion quality and physics. Be specific about movement.",
  "hailuo-2.3":
    "Hailuo produces video with audio. Describe visual and audio elements together.",
  "ray-2":
    "Ray 2 supports camera controls. Specify camera angles and movements.",
  "gpt-image-2":
    "OpenAI gpt-image-2 follows instructions literally. Structure as scene → subject → key details → constraints. Put any literal text in quotes. Include the word 'photorealistic' for photo output. State exclusions explicitly (e.g. 'no watermark', 'no extra text').",
  "gpt-image-1.5":
    "OpenAI gpt-image-1.5 follows instructions literally. Structure as scene → subject → key details → constraints. Put any literal text in quotes. Include the word 'photorealistic' for photo output. State exclusions explicitly (e.g. 'no watermark', 'no extra text').",
  "gpt-image-1":
    "OpenAI gpt-image-1 follows instructions literally. Structure as scene → subject → key details → constraints. Put any literal text in quotes. Include the word 'photorealistic' for photo output. State exclusions explicitly (e.g. 'no watermark', 'no extra text').",
  "gpt-image-1-mini":
    "OpenAI gpt-image-1-mini follows instructions literally. Structure as scene → subject → key details → constraints. Put any literal text in quotes. Include the word 'photorealistic' for photo output. State exclusions explicitly (e.g. 'no watermark', 'no extra text').",
};

/**
 * Enhance a prompt using Mistral's API.
 */
export async function enhancePromptWithLLM(
  basePrompt: string,
  modelId: ModelId
): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY is not configured");
  }

  const modelTip = MODEL_TIPS[modelId] ?? "";

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "mistral-small-latest",
      messages: [
        {
          role: "system",
          content: `You are an expert prompt engineer for AI image generation. Your job is to take a user's rough prompt and rewrite it into a detailed, optimized prompt that will produce the best possible image.

Rules:
- Keep the core intent and subject of the original prompt
- Add relevant details about composition, lighting, style, and quality
- Be specific and descriptive but not overly long (aim for 1-3 sentences)
- Do not add text instructions unless the user specifically wants text in the image
- Output ONLY the improved prompt, nothing else
- Do not wrap in quotes

Model-specific guidance: ${modelTip}`,
        },
        {
          role: "user",
          content: basePrompt,
        },
      ],
      max_tokens: 300,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Mistral API error: ${error}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content?.trim() ?? basePrompt;
}
