import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { GalleryClient } from "./gallery-client";

export default async function GalleryPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Gallery</h1>
        <p className="text-muted-foreground mt-1">
          Browse and manage generated assets.
        </p>
      </div>
      <GalleryClient
        viewer={{
          id: session.user.id,
          displayName: session.user.name ?? null,
          avatarUrl: session.user.image ?? null,
        }}
      />
    </div>
  );
}
