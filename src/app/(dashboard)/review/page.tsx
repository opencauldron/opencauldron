import { ReviewClient } from "./review-client";

export const dynamic = "force-dynamic";

export default function ReviewPage() {
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
      <ReviewClient />
    </div>
  );
}
