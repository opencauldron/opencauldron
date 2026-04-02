"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

const LorasClient = dynamic(() => import("./loras-client").then((m) => m.LorasClient), {
  ssr: false,
  loading: () => (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row gap-3">
        <Skeleton className="h-9 flex-1 rounded-lg" />
        <Skeleton className="h-9 w-[160px] rounded-lg" />
        <Skeleton className="h-9 w-[170px] rounded-lg" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="aspect-[3/4] rounded-lg" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  ),
});

export default function LorasPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">LoRAs</h1>
        <p className="text-muted-foreground mt-1">
          Browse, explore, and favorite LoRAs from Civitai and HuggingFace for use in your generations.
        </p>
      </div>
      <LorasClient />
    </div>
  );
}
