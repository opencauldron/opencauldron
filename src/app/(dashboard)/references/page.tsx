import { ReferencesClient } from "./references-client";

export default function ReferencesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">References</h1>
        <p className="text-muted-foreground mt-1">
          Browse and manage your uploaded reference images.
        </p>
      </div>
      <ReferencesClient />
    </div>
  );
}
