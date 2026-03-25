import { getAvailableModels } from "@/providers/registry";
import { promptModifiers } from "@/providers/prompt-improver";
import { GenerateClient } from "./generate-client";
import { Wand2 } from "lucide-react";

export default function GeneratePage() {
  const imageModels = getAvailableModels("image");
  const videoModels = getAvailableModels("video");

  return (
    <GenerateClient
      imageModels={imageModels}
      videoModels={videoModels}
      modifiers={promptModifiers}
    />
  );
}
