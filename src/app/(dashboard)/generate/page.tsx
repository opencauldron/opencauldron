import { getAvailableModels } from "@/providers/registry";
import { promptModifiers } from "@/providers/prompt-improver";
import { GenerateClient } from "./generate-client";
import { Wand2 } from "lucide-react";

export default function GeneratePage() {
  const imageModels = getAvailableModels("image");
  const videoModels = getAvailableModels("video");

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
          <Wand2 className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">
            Generate
          </h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Create images and videos with AI-powered generation.
          </p>
        </div>
      </div>
      <GenerateClient
        imageModels={imageModels}
        videoModels={videoModels}
        modifiers={promptModifiers}
      />
    </div>
  );
}
