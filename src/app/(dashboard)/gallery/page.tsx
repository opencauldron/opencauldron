import { GalleryClient } from "./gallery-client";

export default function GalleryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Gallery</h1>
        <p className="text-muted-foreground mt-1">
          Browse and manage generated assets.
        </p>
      </div>
      <GalleryClient />
    </div>
  );
}
