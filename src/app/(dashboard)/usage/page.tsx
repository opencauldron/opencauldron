import { UsageClient } from "./usage-client";

export default function UsagePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Usage</h1>
        <p className="text-muted-foreground mt-1">
          Track your generation usage and costs.
        </p>
      </div>
      <UsageClient />
    </div>
  );
}
