import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { z } from "zod";
import { listUserWorkspaces } from "@/lib/workspace/context";
import { bootstrapHostedSignup } from "@/lib/workspace/bootstrap";

const createSchema = z.object({
  name: z.string().min(1).max(100),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await listUserWorkspaces(session.user.id);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (env.WORKSPACE_MODE === "self_hosted") {
    return NextResponse.json(
      { error: "Workspace creation disabled in self-hosted mode" },
      { status: 403 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const result = await bootstrapHostedSignup({
    userId: session.user.id,
    preferredName: parsed.data.name,
  });
  return NextResponse.json(result, { status: 201 });
}
