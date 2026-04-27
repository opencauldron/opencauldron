import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { uploadAsset } from "@/lib/storage";
import { resolvePersonalBrandId } from "@/lib/workspace/personal";
import { z } from "zod";
import { editGrokImage } from "@/providers/grok";
import { remixIdeogramImage } from "@/providers/ideogram";
import { recraftImageToImage } from "@/providers/recraft";
import type { ModelId, GenerationParams } from "@/types";

const editSchema = z.object({
  prompt: z.string().min(1).max(4000),
  imageUrl: z.string().url(),
  provider: z.enum(["xai", "ideogram", "recraft"]),
  aspectRatio: z.string().optional(),
  style: z.string().optional(),
  strength: z.number().min(0).max(1).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const { prompt, imageUrl, provider, aspectRatio, style, strength } = parsed.data;
  const userId = session.user.id;

  const params: GenerationParams = {
    prompt,
    model: "grok-imagine" as ModelId,
    aspectRatio,
    style,
  };

  try {
    let result;
    switch (provider) {
      case "xai":
        result = await editGrokImage(prompt, imageUrl, params);
        break;
      case "ideogram":
        result = await remixIdeogramImage(prompt, imageUrl, params);
        break;
      case "recraft":
        result = await recraftImageToImage(prompt, imageUrl, strength ?? 0.5, params);
        break;
      default:
        return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
    }

    if (result.status === "failed" || !result.imageBuffer) {
      return NextResponse.json({ error: result.error ?? "Edit failed" }, { status: 500 });
    }

    const uploaded = await uploadAsset(result.imageBuffer, userId);
    const brandId = await resolvePersonalBrandId(userId);

    const [asset] = await db
      .insert(assets)
      .values({
        userId,
        brandId,
        status: "draft",
        source: "generation",
        mediaType: "image",
        model: "grok-imagine" as ModelId,
        provider,
        prompt,
        parameters: { aspectRatio, style, strength, imageUrl },
        r2Key: uploaded.key,
        r2Url: uploaded.url,
        thumbnailR2Key: uploaded.thumbnailKey,
        width: uploaded.width,
        height: uploaded.height,
        fileSize: uploaded.fileSize,
        costEstimate: 0.04,
      })
      .returning();

    return NextResponse.json({
      asset: {
        id: asset.id,
        url: uploaded.url,
        width: uploaded.width,
        height: uploaded.height,
        prompt,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Edit failed" },
      { status: 500 },
    );
  }
}
