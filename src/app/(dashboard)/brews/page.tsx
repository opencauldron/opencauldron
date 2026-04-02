"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FlaskConical, Compass } from "lucide-react";

const BrewsClient = dynamic(() => import("./brews-client").then((m) => m.BrewsClient), {
  ssr: false,
  loading: () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-border/40 p-4">
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  ),
});

const ExploreClient = dynamic(() => import("./explore-client").then((m) => m.ExploreClient), {
  ssr: false,
  loading: () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-border/40 p-4">
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  ),
});

export default function BrewsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Brews</h1>
        <p className="text-muted-foreground mt-1">
          Save, share, and discover generation recipes.
        </p>
      </div>
      <Tabs defaultValue="my-brews">
        <TabsList variant="line">
          <TabsTrigger value="my-brews" className="gap-1.5">
            <FlaskConical className="h-4 w-4" />
            My Brews
          </TabsTrigger>
          <TabsTrigger value="explore" className="gap-1.5">
            <Compass className="h-4 w-4" />
            Explore
          </TabsTrigger>
        </TabsList>
        <TabsContent value="my-brews">
          <BrewsClient />
        </TabsContent>
        <TabsContent value="explore">
          <ExploreClient />
        </TabsContent>
      </Tabs>
    </div>
  );
}
