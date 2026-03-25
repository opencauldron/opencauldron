import { LorasClient } from "./loras-client";

export default function LorasPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">LoRAs</h1>
        <p className="text-muted-foreground mt-1">
          Browse, explore, and favorite LoRAs from Civitai for use in your generations.
        </p>
      </div>
      <LorasClient />
    </div>
  );
}
