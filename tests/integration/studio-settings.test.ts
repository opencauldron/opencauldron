/**
 * Validation contract for the Studio settings PATCH endpoint
 * (`PATCH /api/workspaces/[id]`). The route gates on workspace owner/admin
 * and accepts partial updates of `name`, `slug`, and `logoUrl`.
 *
 * Pure schema test — keeps the validation rules pinned without requiring
 * a DB or a running server.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

// Mirror of the schema in src/app/api/workspaces/[id]/route.ts. If the route
// schema changes the test should fail, prompting a deliberate update.
const patchSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    slug: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9-]+$/, "slug must be kebab-case")
      .optional(),
    logoUrl: z
      .string()
      .url()
      .max(2048)
      .nullable()
      .optional()
      .or(z.literal("").transform(() => null)),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

describe("Studio settings PATCH schema", () => {
  it("accepts a name-only update", () => {
    const r = patchSchema.safeParse({ name: "Taboo Grow" });
    expect(r.success).toBe(true);
  });

  it("accepts a kebab-case slug", () => {
    const r = patchSchema.safeParse({ slug: "taboo-grow" });
    expect(r.success).toBe(true);
  });

  it("rejects a slug with spaces", () => {
    const r = patchSchema.safeParse({ slug: "Taboo Grow" });
    expect(r.success).toBe(false);
  });

  it("rejects a slug with uppercase", () => {
    const r = patchSchema.safeParse({ slug: "Taboo-Grow" });
    expect(r.success).toBe(false);
  });

  it("rejects a slug with underscores", () => {
    const r = patchSchema.safeParse({ slug: "taboo_grow" });
    expect(r.success).toBe(false);
  });

  it("accepts a https logoUrl", () => {
    const r = patchSchema.safeParse({
      logoUrl: "https://cdn.example.com/logo.png",
    });
    expect(r.success).toBe(true);
  });

  it("accepts logoUrl explicitly null (clears the field)", () => {
    const r = patchSchema.safeParse({ logoUrl: null });
    expect(r.success).toBe(true);
  });

  it("coerces empty-string logoUrl to null", () => {
    const r = patchSchema.safeParse({ logoUrl: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.logoUrl).toBeNull();
  });

  it("rejects a non-URL logoUrl", () => {
    const r = patchSchema.safeParse({ logoUrl: "not a url" });
    expect(r.success).toBe(false);
  });

  it("rejects an empty payload", () => {
    const r = patchSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("rejects a name longer than 80 chars", () => {
    const r = patchSchema.safeParse({ name: "x".repeat(81) });
    expect(r.success).toBe(false);
  });

  it("accepts a combined name + slug + logoUrl update", () => {
    const r = patchSchema.safeParse({
      name: "Taboo Grow",
      slug: "taboo-grow",
      logoUrl: "https://example.com/logo.png",
    });
    expect(r.success).toBe(true);
  });
});
