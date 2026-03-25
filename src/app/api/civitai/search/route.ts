import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const query = searchParams.get("query");
  const nsfw = searchParams.get("nsfw") ?? "false";
  const cursor = searchParams.get("cursor");
  const sort = searchParams.get("sort") ?? "Most Downloaded";
  const baseModel = searchParams.get("baseModel") ?? "Flux.1 D";

  const url = new URL("https://civitai.com/api/v1/models");
  url.searchParams.set("types", "LORA");
  url.searchParams.set("baseModels", baseModel);
  url.searchParams.set("sort", sort);
  url.searchParams.set("limit", "20");
  url.searchParams.set("nsfw", nsfw);

  if (query) {
    url.searchParams.set("query", query);
  }
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  const headers: HeadersInit = {};
  const apiKey = process.env.CIVITAI_API_KEY;
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(url.toString(), { headers });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch from Civitai" },
        { status: 502 }
      );
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch from Civitai" },
      { status: 502 }
    );
  }
}
