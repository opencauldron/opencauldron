import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const HF_BASE_MODEL_FILTERS: Record<string, string> = {
  "Flux.1 D": "base_model:adapter:black-forest-labs/FLUX.1-dev",
  "SDXL 1.0": "base_model:adapter:stabilityai/stable-diffusion-xl-base-1.0",
  "SD 1.5": "base_model:adapter:runwayml/stable-diffusion-v1-5",
};

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const query = searchParams.get("query");
  const cursor = searchParams.get("cursor");
  const sort = searchParams.get("sort") ?? "downloads";
  const baseModel = searchParams.get("baseModel") ?? "Flux.1 D";

  const filters = ["lora"];
  const hfBaseFilter = HF_BASE_MODEL_FILTERS[baseModel];
  if (hfBaseFilter) filters.push(hfBaseFilter);

  const headers: HeadersInit = {};
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  // HF uses full URL cursor from Link header. If cursor is provided,
  // fetch it directly.
  if (cursor) {
    try {
      const cursorUrl = new URL(cursor);
      const response = await fetch(cursorUrl.toString(), { headers });
      if (!response.ok) {
        return NextResponse.json({ error: "Failed to fetch from HuggingFace" }, { status: 502 });
      }

      const models = await response.json();
      const linkHeader = response.headers.get("Link");
      const nextCursor = parseLinkHeader(linkHeader);

      const items = transformHfModels(models);
      return NextResponse.json({ items, nextCursor }, {
        headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
      });
    } catch {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
  }

  const url = new URL("https://huggingface.co/api/models");
  url.searchParams.set("filter", filters.join(","));
  url.searchParams.set("sort", sort);
  url.searchParams.set("direction", "-1");
  url.searchParams.set("limit", "20");
  url.searchParams.set("full", "true");
  if (query) url.searchParams.set("search", query);

  try {
    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      return NextResponse.json({ error: "Failed to fetch from HuggingFace" }, { status: 502 });
    }

    const models = await response.json();
    const linkHeader = response.headers.get("Link");
    const nextCursor = parseLinkHeader(linkHeader);

    const items = transformHfModels(models);
    return NextResponse.json({ items, nextCursor }, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch from HuggingFace" }, { status: 502 });
  }
}

function parseLinkHeader(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

interface HfApiModel {
  id: string;
  downloads: number;
  likes: number;
  tags: string[];
  createdAt: string;
  lastModified: string;
  pipelineTag?: string;
  siblings?: Array<{ rfilename: string }>;
  cardData?: { instance_prompt?: string; widget?: Array<{ output?: { url?: string } }> };
}

function transformHfModels(models: HfApiModel[]) {
  return models.map((m) => {
    const author = m.id.split("/")[0] ?? "";
    const safetensorsFiles = (m.siblings ?? [])
      .filter((s) => s.rfilename.endsWith(".safetensors"))
      .map((s) => s.rfilename);

    // Build preview image URL from first image file in the repo
    let previewImageUrl: string | null = null;
    const imageFiles = (m.siblings ?? [])
      .filter((s) => /\.(png|jpg|jpeg|webp)$/i.test(s.rfilename))
      .map((s) => s.rfilename);
    if (imageFiles.length > 0) {
      previewImageUrl = `https://huggingface.co/${m.id}/resolve/main/${imageFiles[0]}`;
    }

    // Get trigger words from instance_prompt
    const instancePrompt = m.cardData?.instance_prompt;
    const triggerWords = instancePrompt
      ? instancePrompt.split(",").map((w: string) => w.trim()).filter(Boolean)
      : [];

    // Get download URL for first safetensors file
    const downloadUrl = safetensorsFiles.length > 0
      ? `https://huggingface.co/${m.id}/resolve/main/${safetensorsFiles[0]}`
      : null;

    return {
      id: m.id,
      author,
      name: m.id.split("/").pop() ?? m.id,
      downloads: m.downloads,
      likes: m.likes,
      tags: m.tags ?? [],
      createdAt: m.createdAt,
      lastModified: m.lastModified,
      previewImageUrl,
      triggerWords,
      downloadUrl,
      safetensorsFiles,
    };
  });
}
