/**
 * Brand-kit composition matrix (T134 / FR-015 / FR-015a / FR-016).
 *
 * Pure-function tests over `composeKit`, the lifted-out part of
 * `applyBrandKit`. The DB-backed wrapper (`applyBrandKit`) is a thin shim
 * around `composeKit` so this matrix is the source of truth for the kit
 * injection contract.
 */

import { describe, expect, it } from "vitest";
import {
  BannedTermError,
  composeKit,
  type BrandKitInput,
  type KitRow,
} from "@/lib/workspace/brand-kit";

const NO_KIT: KitRow = {
  promptPrefix: null,
  promptSuffix: null,
  bannedTerms: [],
  defaultLoraId: null,
  defaultLoraIds: [],
  anchorReferenceIds: [],
  workspaceDefaultLoraId: null,
};

const baseInput = (overrides: Partial<BrandKitInput> = {}): BrandKitInput => ({
  workspaceId: "ws-1",
  brandId: "brand-1",
  prompt: "a cat",
  parameters: null,
  imageInput: [],
  loras: [],
  override: false,
  ...overrides,
});

describe("composeKit — pass-through paths", () => {
  it("kit=null acts as pass-through (no overridden flag)", () => {
    const out = composeKit(baseInput({ prompt: "raw prompt" }), null);
    expect(out.promptFinal).toBe("raw prompt");
    expect(out.lorasFinal).toEqual([]);
    expect(out.imageInputFinal).toEqual([]);
    expect(out.brandKitOverridden).toBe(false);
  });

  it("override=true bypasses kit and flags overridden=true", () => {
    const kit: KitRow = {
      ...NO_KIT,
      promptPrefix: "studio shot,",
      promptSuffix: ", ultra-clean",
      bannedTerms: ["neon"],
    };
    const out = composeKit(
      baseInput({ prompt: "neon kitten", override: true }),
      kit
    );
    expect(out.promptFinal).toBe("neon kitten"); // prefix/suffix skipped
    expect(out.brandKitOverridden).toBe(true); // user opted out
  });
});

describe("composeKit — prefix/suffix injection (FR-015)", () => {
  it("prefix only", () => {
    const kit: KitRow = { ...NO_KIT, promptPrefix: "studio shot," };
    expect(composeKit(baseInput(), kit).promptFinal).toBe(
      "studio shot, a cat"
    );
  });

  it("suffix only", () => {
    const kit: KitRow = { ...NO_KIT, promptSuffix: ", ultra-clean" };
    expect(composeKit(baseInput(), kit).promptFinal).toBe(
      "a cat , ultra-clean"
    );
  });

  it("both prefix and suffix", () => {
    const kit: KitRow = {
      ...NO_KIT,
      promptPrefix: "studio shot,",
      promptSuffix: ", ultra-clean",
    };
    expect(composeKit(baseInput(), kit).promptFinal).toBe(
      "studio shot, a cat , ultra-clean"
    );
  });

  it("neither prefix nor suffix → unchanged prompt", () => {
    const out = composeKit(baseInput(), NO_KIT);
    expect(out.promptFinal).toBe("a cat");
    expect(out.brandKitOverridden).toBe(false);
  });

  it("prefix/suffix whitespace is trimmed", () => {
    const kit: KitRow = {
      ...NO_KIT,
      promptPrefix: "   studio shot,   ",
      promptSuffix: "   , clean   ",
    };
    expect(composeKit(baseInput(), kit).promptFinal).toBe(
      "studio shot, a cat , clean"
    );
  });
});

describe("composeKit — banned terms (FR-015 / FR-016)", () => {
  it("rejects with BannedTermError naming the matched term", () => {
    const kit: KitRow = { ...NO_KIT, bannedTerms: ["neon"] };
    expect(() =>
      composeKit(baseInput({ prompt: "a NEON cat" }), kit)
    ).toThrow(BannedTermError);
  });

  it("error.matchedTerm preserves brand-kit casing", () => {
    const kit: KitRow = { ...NO_KIT, bannedTerms: ["Neon"] };
    try {
      composeKit(baseInput({ prompt: "a neon cat" }), kit);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BannedTermError);
      expect((err as BannedTermError).matchedTerm).toBe("Neon");
    }
  });

  it("override=true skips the banned-term gate", () => {
    const kit: KitRow = { ...NO_KIT, bannedTerms: ["neon"] };
    expect(() =>
      composeKit(baseInput({ prompt: "neon cat", override: true }), kit)
    ).not.toThrow();
  });

  it("empty bannedTerms list never throws", () => {
    const kit: KitRow = { ...NO_KIT };
    expect(() =>
      composeKit(baseInput({ prompt: "anything goes" }), kit)
    ).not.toThrow();
  });
});

describe("composeKit — LoRA precedence (FR-015a)", () => {
  it("user explicit LoRAs win over brand-default", () => {
    const kit: KitRow = {
      ...NO_KIT,
      defaultLoraId: "brand-default",
      defaultLoraIds: ["brand-extra"],
      workspaceDefaultLoraId: "ws-default",
    };
    const out = composeKit(
      baseInput({ loras: ["user-pick"] }),
      kit
    );
    expect(out.lorasFinal).toEqual(["user-pick"]);
  });

  it("no user LoRAs → brand defaultLoraId leads + dedupes vs defaultLoraIds", () => {
    const kit: KitRow = {
      ...NO_KIT,
      defaultLoraId: "brand-default",
      defaultLoraIds: ["brand-default", "brand-extra"],
      workspaceDefaultLoraId: "ws-default",
    };
    const out = composeKit(baseInput(), kit);
    expect(out.lorasFinal).toEqual(["brand-default", "brand-extra"]);
  });

  it("no user, no brand-default → brand defaultLoraIds list", () => {
    const kit: KitRow = {
      ...NO_KIT,
      defaultLoraIds: ["brand-extra"],
      workspaceDefaultLoraId: "ws-default",
    };
    expect(composeKit(baseInput(), kit).lorasFinal).toEqual(["brand-extra"]);
  });

  it("no user, no brand → workspace default applies", () => {
    const kit: KitRow = { ...NO_KIT, workspaceDefaultLoraId: "ws-default" };
    expect(composeKit(baseInput(), kit).lorasFinal).toEqual(["ws-default"]);
  });

  it("no user, no brand, no workspace → empty", () => {
    expect(composeKit(baseInput(), NO_KIT).lorasFinal).toEqual([]);
  });

  it("Personal-brand semantics — workspace default applies (no brand override)", () => {
    // Personal brands have no brand-default by design (per OQ-001 resolution).
    const kit: KitRow = { ...NO_KIT, workspaceDefaultLoraId: "ws-default" };
    expect(composeKit(baseInput(), kit).lorasFinal).toEqual(["ws-default"]);
  });
});

describe("composeKit — anchor reference inclusion (FR-016)", () => {
  it("user-supplied refs win — anchors silent", () => {
    const kit: KitRow = {
      ...NO_KIT,
      anchorReferenceIds: ["anchor-1", "anchor-2"],
    };
    const out = composeKit(
      baseInput({ imageInput: ["user-ref"] }),
      kit
    );
    expect(out.imageInputFinal).toEqual(["user-ref"]);
  });

  it("no user refs → kit anchors flow through", () => {
    const kit: KitRow = {
      ...NO_KIT,
      anchorReferenceIds: ["anchor-1", "anchor-2"],
    };
    expect(composeKit(baseInput(), kit).imageInputFinal).toEqual([
      "anchor-1",
      "anchor-2",
    ]);
  });

  it("no user refs, no anchors → empty", () => {
    expect(composeKit(baseInput(), NO_KIT).imageInputFinal).toEqual([]);
  });

  it("override=true skips anchor inclusion", () => {
    const kit: KitRow = { ...NO_KIT, anchorReferenceIds: ["anchor-1"] };
    expect(
      composeKit(baseInput({ override: true }), kit).imageInputFinal
    ).toEqual([]);
  });
});

describe("composeKit — parameters pass-through", () => {
  it("preserves caller parameters as a fresh object", () => {
    const params = { aspectRatio: "16:9", quality: "high" };
    const out = composeKit(baseInput({ parameters: params }), NO_KIT);
    expect(out.parametersFinal).toEqual(params);
    // Defensive copy — callers can mutate without leaking.
    expect(out.parametersFinal).not.toBe(params);
  });

  it("null parameters becomes empty object", () => {
    expect(
      composeKit(baseInput({ parameters: null }), NO_KIT).parametersFinal
    ).toEqual({});
  });
});

describe("composeKit — overridden flag", () => {
  it("=false on the kit-applied path", () => {
    const kit: KitRow = { ...NO_KIT, promptPrefix: "studio shot," };
    expect(composeKit(baseInput(), kit).brandKitOverridden).toBe(false);
  });

  it("=true when user toggled override", () => {
    expect(
      composeKit(baseInput({ override: true }), NO_KIT).brandKitOverridden
    ).toBe(true);
  });

  it("=false when no kit row exists (treated as pass-through, not override)", () => {
    expect(composeKit(baseInput(), null).brandKitOverridden).toBe(false);
  });
});
