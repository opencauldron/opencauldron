import { BrandsClient } from "./brands-client";

export default function BrandsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Brands</h1>
        <p className="text-muted-foreground mt-1">
          Manage brand tags for your assets.
        </p>
      </div>
      <BrandsClient />
    </div>
  );
}
