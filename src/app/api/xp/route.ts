import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserXP, getLevelProgress } from "@/lib/xp";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const record = await getUserXP(session.user.id);
  const progress = getLevelProgress(record.xp);

  return NextResponse.json(progress);
}
