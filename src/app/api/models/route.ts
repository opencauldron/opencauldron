import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAvailableModels } from "@/providers/registry";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const models = getAvailableModels();
  return NextResponse.json({ models });
}
