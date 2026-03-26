"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

const BrewsClient = dynamic(() => import("./brews-client").then((m) => m.BrewsClient), {
  ssr: false,
  loading: () => (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-[200px] rounded-lg" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-border/40 p-4">
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  ),
});

export default function BrewsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Brews</h1>
        <p className="text-muted-foreground mt-1">
          Your saved generation recipes. Load a brew to instantly configure model, LoRAs, and parameters.
        </p>
      </div>
      <BrewsClient />
    </div>
  );
}
