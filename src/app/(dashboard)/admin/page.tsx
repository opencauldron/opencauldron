import { AdminClient } from "./admin-client";

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
        <p className="text-muted-foreground mt-1">
          Manage team, usage limits, and view team stats.
        </p>
      </div>
      <AdminClient />
    </div>
  );
}
