import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, workspaceMembers, workspaces } from "@/lib/db/schema";

const onboardingSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  workspaceName: z.string().trim().min(1).max(80),
  acceptedTerms: z.literal(true),
  acceptedPrivacy: z.literal(true),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => null);
  const parsed = onboardingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { displayName, workspaceName } = parsed.data;
  const now = new Date();

  await db
    .update(users)
    .set({
      name: displayName,
      onboardingCompletedAt: now,
      acceptedTermsAt: now,
      acceptedPrivacyAt: now,
    })
    .where(eq(users.id, userId));

  // Rename the user's bootstrap workspace only if its name still matches the
  // default `bootstrapHostedSignup` produced. Users who already customized
  // their workspace name (e.g. via Studio Settings before completing
  // onboarding) keep their custom name.
  const ownedWorkspaces = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.role, "owner")
      )
    )
    .orderBy(workspaces.createdAt)
    .limit(1);

  const owned = ownedWorkspaces[0];
  if (owned) {
    const oldName = owned.name;
    const isBootstrapDefault =
      oldName === "My Studio" || /^.+'s Studio$/i.test(oldName);
    if (isBootstrapDefault && oldName !== workspaceName) {
      await db
        .update(workspaces)
        .set({ name: workspaceName })
        .where(eq(workspaces.id, owned.id));
    }
  }

  return NextResponse.json({ ok: true });
}
