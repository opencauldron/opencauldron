import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ReviewClient } from "./review-client";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">
          Review queue
        </h1>
        <p className="mt-1 text-muted-foreground">
          Approve, reject, and triage assets pending review on the brands you manage.
        </p>
      </div>
      <ReviewClient
        viewer={{
          id: session.user.id,
          displayName: session.user.name ?? null,
          avatarUrl: session.user.image ?? null,
        }}
      />
    </div>
  );
}
