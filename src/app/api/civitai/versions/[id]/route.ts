import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const url = `https://civitai.com/api/v1/model-versions/${id}`;

  const headers: HeadersInit = {};
  const apiKey = process.env.CIVITAI_API_KEY;
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(url, { headers });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch from Civitai" },
        { status: 502 }
      );
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch from Civitai" },
      { status: 502 }
    );
  }
}
