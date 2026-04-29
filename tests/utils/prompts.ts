import type { ModelId } from "@/types";

export interface TestPromptConfig {
  prompt: string;
  aspectRatio?: string;
  style?: string;
  renderingSpeed?: "TURBO" | "DEFAULT" | "QUALITY";
  timeoutMs: number;
}

export const TEST_PROMPTS: Record<string, TestPromptConfig> = {
  // ── Google Imagen ──────────────────────────────────────────
  "imagen-4": {
    prompt:
      "A luminous cauldron carved from obsidian sitting atop a stone pedestal in a mystical forest clearing at golden hour. Purple and indigo magical smoke spirals upward, forming holographic images of landscapes, portraits, and abstract art. Fireflies and tiny sparks of light float around the cauldron. Photorealistic, cinematic lighting, shallow depth of field, 8K detail.",
    aspectRatio: "16:9",
    timeoutMs: 30_000,
  },
  "imagen-flash": {
    prompt:
      "A sleek dark cauldron on a wooden workbench surrounded by glowing vials of purple and blue liquid. Magical sparks fly from the cauldron's rim. A leather-bound spellbook lies open nearby with diagrams of neural networks drawn in golden ink. Warm ambient lighting, cozy workshop atmosphere.",
    aspectRatio: "1:1",
    timeoutMs: 60_000,
  },
  "imagen-flash-lite": {
    prompt:
      "Minimalist icon of a bubbling cauldron with purple magical flames, dark background, flat design with subtle gradients, app icon style.",
    aspectRatio: "1:1",
    timeoutMs: 15_000,
  },
  "imagen-4-ultra": {
    prompt:
      "An ancient grand cauldron of hammered copper and silver in the center of an alchemist's tower library. Floor-to-ceiling bookshelves filled with arcane tomes. The cauldron emits a vertical beam of iridescent light that projects a galaxy of tiny floating images rotating slowly in the air. Volumetric god rays stream through stained glass windows casting purple and gold patterns on stone floors. Ultra-detailed, museum-quality photograph, medium format film look.",
    aspectRatio: "4:3",
    timeoutMs: 60_000,
  },
  "imagen-4-fast": {
    prompt:
      "A stylish cauldron logo mark glowing with purple neon light against a dark gradient background. Clean, modern, tech-startup aesthetic. The cauldron has geometric facets like a cut gemstone.",
    aspectRatio: "1:1",
    timeoutMs: 20_000,
  },

  // ── xAI Grok ──────────────────────────────────────────────
  "grok-imagine": {
    prompt:
      "A whimsical steampunk cauldron with brass gears, copper pipes, and pressure gauges. It sits on an inventor's workbench surrounded by blueprints and tools. Colorful potions bubble inside, creating a rainbow mist. Fun, creative, slightly surreal illustration style with warm tones.",
    aspectRatio: "1:1",
    timeoutMs: 30_000,
  },
  "grok-imagine-pro": {
    prompt:
      "A majestic crystal cauldron floating above a reflective obsidian platform in a vast cosmic void. The cauldron contains a swirling nebula of purple, magenta, and electric blue energy. Tendrils of starlight extend outward, each tendril ending in a different style of artwork. Dramatic rim lighting, hyper-detailed, award-winning digital art.",
    aspectRatio: "16:9",
    timeoutMs: 45_000,
  },

  // ── BFL Flux ───────────────────────────────────────────────
  "flux-1.1-pro": {
    prompt:
      "An enchanted iron cauldron in a moonlit stone courtyard overgrown with ivy and glowing mushrooms. Purple and silver magical essence pours over the rim like dry ice fog, pooling on cobblestones. A crescent moon hangs overhead. The scene has a painterly quality with rich textures and deep shadows. Fantasy concept art style.",
    aspectRatio: "16:9",
    timeoutMs: 90_000,
  },
  "flux-dev": {
    prompt:
      "A futuristic holographic cauldron projected from a sleek black pedestal in a minimalist white gallery space. The hologram flickers between purple and cyan. Inside the projection, abstract 3D shapes morph and transform. Clean sci-fi aesthetic, architectural photography style.",
    aspectRatio: "1:1",
    timeoutMs: 90_000,
  },
  "flux-kontext-pro": {
    prompt:
      "An elegant product photograph of a matte black ceramic cauldron with gold serif lettering embossed on its side. The cauldron sits on a marble surface with soft purple backlighting creating a halo effect. Studio product photography, commercial quality.",
    aspectRatio: "1:1",
    timeoutMs: 90_000,
  },
  "flux-2-klein": {
    prompt:
      "A cute cartoon cauldron character with big eyes and a friendly smile, bubbling with colorful potions, kawaii style, pastel purple background, sticker design.",
    aspectRatio: "1:1",
    timeoutMs: 90_000,
  },

  // ── Ideogram ───────────────────────────────────────────────
  "ideogram-3": {
    prompt:
      "A dramatic poster design featuring a mystical cauldron at center with elegant typography reading \"OPEN CAULDRON\" in a modern serif font above and \"AI Media Studio\" in lighter weight below. The cauldron emits swirling purple and gold magical energy that frames the text. Dark background with subtle star field. Professional typographic poster design, balanced composition.",
    aspectRatio: "4:3",
    style: "design",
    renderingSpeed: "QUALITY",
    timeoutMs: 45_000,
  },

  // ── Recraft ────────────────────────────────────────────────
  "recraft-v3": {
    prompt:
      "A clean vector illustration of a bubbling cauldron with three stylized magical flames underneath in purple, indigo, and violet. Simple geometric shapes, limited color palette of purples and golds on a dark navy background. Suitable for a brand icon or social media avatar.",
    aspectRatio: "1:1",
    style: "vector_illustration",
    timeoutMs: 30_000,
  },
  "recraft-20b": {
    prompt:
      "A hand-drawn sketch style illustration of an alchemist's workspace with a central cauldron surrounded by bottles, herbs, scrolls, and a quill pen. Warm sepia and purple ink tones on cream parchment. Whimsical, detailed line art with crosshatching.",
    aspectRatio: "16:9",
    style: "digital_illustration",
    timeoutMs: 30_000,
  },
  "recraft-v4": {
    prompt:
      "A moody illustration of a lone cauldron on a cliff edge overlooking a vast twilight sea. Purple auroral lights dance in the sky above. The cauldron glows from within, casting warm light on nearby rocks. Atmospheric, emotional, painterly digital art with strong sense of scale and solitude.",
    aspectRatio: "1:1",
    timeoutMs: 30_000,
  },
  "recraft-v4-pro": {
    prompt:
      "A photorealistic still life of an antique bronze cauldron on a dark wooden table. Inside the cauldron, a perfectly still pool of liquid reflects purple ambient light. Surrounding the cauldron: dried lavender bundles, amethyst crystals, a brass compass, and scattered gold leaf. Shot with medium format camera, tilt-shift lens, extremely detailed textures. Professional product photography for a luxury brand catalog.",
    aspectRatio: "1:1",
    style: "realistic_image",
    timeoutMs: 45_000,
  },

  // ── OpenAI ────────────────────────────────────────────────
  "gpt-image-2": {
    prompt:
      "A radiant cauldron carved from polished onyx with veins of gold, sitting on a circle of glowing runes. Violet smoke rises in elegant tendrils, twisting into the shape of letters spelling OPEN CAULDRON. Sharp text rendering, photorealistic materials, soft volumetric lighting, dark background.",
    aspectRatio: "1:1",
    timeoutMs: 60_000,
  },
  "gpt-image-1.5": {
    prompt:
      "An ornate alchemist's workbench at dusk, brass instruments gleaming, an open spellbook with hand-lettered runes, a single floating ember above a sapphire-blue potion. Painterly fantasy realism, sharp focus on the book.",
    aspectRatio: "1:1",
    timeoutMs: 60_000,
  },
  "gpt-image-1": {
    prompt:
      "A bubbling copper cauldron in an apothecary's nook, surrounded by jars of dried herbs and crystal vials. Steam curls upward into wisps that almost look like tiny constellations. Warm candle light, painterly fantasy illustration with crisp focal subject.",
    aspectRatio: "3:2",
    timeoutMs: 60_000,
  },
  "gpt-image-1-mini": {
    prompt:
      "A minimalist sticker design of a smiling cauldron with bubbling purple potion, transparent background, bold outlines, kawaii style.",
    aspectRatio: "1:1",
    timeoutMs: 45_000,
  },

  // ── Wan (fal.ai) ─────────────────────────────────────────
  "wan-2.1": {
    prompt:
      "A glowing cauldron in the center of an ancient stone chamber slowly comes to life. Purple and violet magical energy spirals upward from the bubbling liquid, casting dancing shadows on the walls. Tiny golden sparks drift through the air like fireflies. The camera slowly orbits around the cauldron as the light intensifies. Cinematic, atmospheric, fantasy mood.",
    aspectRatio: "16:9",
    timeoutMs: 180_000,
  },
};
