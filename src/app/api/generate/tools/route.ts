import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadAsset } from "@/lib/storage";
import { z } from "zod";
import { upscaleIdeogramImage } from "@/providers/ideogram";
import { upscaleRecraftImage, removeRecraftBackground, vectorizeRecraftImage } from "@/providers/recraft";

const toolsSchema = z.object({
  action: z.enum(["upscale", "remove-background", "vectorize"]),
  imageUrl: z.string().url(),
  provider: z.enum(["ideogram", "recraft"]).optional(),
  // Upscale options
  resemblance: z.number().min(0).max(100).optional(),
  detail: z.number().min(0).max(100).optional(),
  upscaleMode: z.enum(["crisp", "creative"]).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = toolsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const { action, imageUrl, provider, resemblance, detail, upscaleMode } = parsed.data;
  const userId = session.user.id;

  try {
    let result;
    switch (action) {
      case "upscale":
        if (provider === "ideogram") {
          result = await upscaleIdeogramImage(imageUrl, resemblance ?? 50, detail ?? 50);
        } else {
          result = await upscaleRecraftImage(imageUrl, upscaleMode ?? "crisp");
        }
        break;
      case "remove-background":
        result = await removeRecraftBackground(imageUrl);
        break;
      case "vectorize":
        result = await vectorizeRecraftImage(imageUrl);
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    if (result.status === "failed") {
      return NextResponse.json({ error: result.error ?? "Operation failed" }, { status: 500 });
    }

    // If we got a buffer, upload it
    if (result.imageBuffer) {
      const uploaded = await uploadAsset(result.imageBuffer, userId);
      return NextResponse.json({
        url: uploaded.url,
        width: uploaded.width,
        height: uploaded.height,
      });
    }

    // SVG/URL result
    return NextResponse.json({ url: result.imageUrl });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Operation failed" },
      { status: 500 },
    );
  }
}
