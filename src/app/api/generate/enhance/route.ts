import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  applyTemplateModifiers,
  enhancePromptWithLLM,
} from "@/providers/prompt-improver";
import { z } from "zod";
import type { ModelId, PromptTemplate } from "@/types";

const enhanceSchema = z.object({
  prompt: z.string().min(1).max(4000),
  mode: z.enum(["template", "llm"]),
  model: z.enum([
    "imagen-4",
    "imagen-flash",
    "imagen-flash-lite",
    "grok-imagine",
    "grok-imagine-pro",
    "flux-1.1-pro",
    "flux-dev",
    "ideogram-3",
    "recraft-v3",
    "recraft-20b",
  ]),
  template: z
    .object({
      style: z.string().optional(),
      lighting: z.string().optional(),
      composition: z.string().optional(),
      mood: z.string().optional(),
      quality: z.string().optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = enhanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { prompt, mode, model, template } = parsed.data;

  try {
    let enhanced: string;

    if (mode === "template") {
      enhanced = applyTemplateModifiers(prompt, (template ?? {}) as PromptTemplate);
    } else {
      enhanced = await enhancePromptWithLLM(prompt, model as ModelId);
    }

    return NextResponse.json({ enhanced });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Enhancement failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
