"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/avatar";
import {
  FlaskConical,
  Copy,
  ArrowLeft,
  Loader2,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import type { PublicBrew } from "@/types";

interface BrewDetailProps {
  brew: PublicBrew;
  isAuthenticated: boolean;
  isOwner: boolean;
}

export function BrewDetail({ brew, isAuthenticated, isOwner }: BrewDetailProps) {
  const router = useRouter();
  const [isCloning, setIsCloning] = useState(false);

  const initials = brew.authorName
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase() ?? "?";

  const params = brew.parameters as Record<string, unknown> | null;
  const loras = params?.loras as Array<{
    name: string;
    scale: number;
    triggerWords?: string[];
    previewImageUrl?: string;
  }> | undefined;

  const handleClone = useCallback(async () => {
    if (!isAuthenticated) {
      router.push(`/login`);
      return;
    }

    setIsCloning(true);
    try {
      const res = await fetch(`/api/brews/${brew.id}/clone`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to clone brew");
        return;
      }
      toast.success("Brew cloned to your collection!");
      router.push("/brews");
    } catch {
      toast.error("Failed to clone brew");
    } finally {
      setIsCloning(false);
    }
  }, [brew.id, isAuthenticated, router]);

  // Display-friendly parameter entries
  const displayParams = params
    ? Object.entries(params)
        .filter(([key]) => !["loras"].includes(key))
        .filter(([, value]) => value !== null && value !== undefined && value !== "")
    : [];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="flex items-center gap-1.5">
            <FlaskConical className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">OpenCauldron</span>
          </div>
        </div>
      </header>

      {/* Two-column layout */}
      <main className="mx-auto max-w-6xl px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 items-start">
          {/* Left column — Preview + Reference Images */}
          <div className="space-y-4">
            {brew.previewUrl ? (
              <div className="rounded-xl overflow-hidden border border-border/40 bg-muted/20">
                <img
                  src={brew.previewUrl}
                  alt={brew.name}
                  className="w-full max-h-[calc(100vh-180px)] object-contain"
                />
              </div>
            ) : null}

            {/* Reference images inline below preview */}
            {brew.imageInput && brew.imageInput.length > 0 ? (
              <div className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Reference Images ({brew.imageInput.length})
                </h2>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {brew.imageInput.map((url, i) => (
                    <div
                      key={i}
                      className="shrink-0 rounded-lg overflow-hidden border border-border/40 bg-muted/20"
                    >
                      <img
                        src={url}
                        alt={`Reference ${i + 1}`}
                        className="h-20 w-20 object-cover"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* Right column — Details */}
          <div className="space-y-5 lg:sticky lg:top-6">
            {/* Title + model */}
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-xl font-bold tracking-tight leading-tight">
                  {brew.name}
                </h1>
                <Badge variant="outline" className="shrink-0 text-xs">
                  {brew.model}
                </Badge>
              </div>
              {brew.description ? (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {brew.description}
                </p>
              ) : null}
            </div>

            {/* Author + usage */}
            <div className="flex items-center gap-2">
              <Avatar className="h-5 w-5">
                {brew.authorImage ? (
                  <AvatarImage
                    src={brew.authorImage}
                    alt={brew.authorName ?? ""}
                  />
                ) : null}
                <AvatarFallback className="text-[9px]">{initials}</AvatarFallback>
              </Avatar>
              <span className="text-sm text-muted-foreground">
                {brew.authorName ?? "Unknown"}
              </span>
              {brew.usageCount > 0 ? (
                <Badge variant="outline" className="text-xs font-normal ml-1">
                  Used {brew.usageCount}x
                </Badge>
              ) : null}
            </div>

            {/* Clone button */}
            {!isOwner ? (
              <Button
                onClick={handleClone}
                disabled={isCloning}
                className="w-full"
                size="lg"
              >
                {isCloning ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                Clone to My Brews
              </Button>
            ) : null}

            {/* Prompt */}
            {brew.prompt ? (
              <div className="space-y-1.5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Prompt
                </h2>
                <div className="rounded-lg border border-border/40 bg-muted/10 p-3 max-h-32 overflow-y-auto">
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">
                    {brew.prompt}
                  </p>
                </div>
              </div>
            ) : null}

            {brew.enhancedPrompt ? (
              <div className="space-y-1.5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Enhanced Prompt
                </h2>
                <div className="rounded-lg border border-border/40 bg-muted/10 p-3 max-h-32 overflow-y-auto">
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed">
                    {brew.enhancedPrompt}
                  </p>
                </div>
              </div>
            ) : null}

            {/* Parameters */}
            {displayParams.length > 0 ? (
              <div className="space-y-1.5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Parameters
                </h2>
                <div className="rounded-lg border border-border/40 bg-muted/10 p-3">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {displayParams.map(([key, value]) => (
                      <div key={key}>
                        <dt className="text-[11px] text-muted-foreground capitalize">
                          {key.replace(/([A-Z])/g, " $1").trim()}
                        </dt>
                        <dd className="text-sm font-medium">
                          {typeof value === "boolean"
                            ? value
                              ? "Yes"
                              : "No"
                            : String(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            ) : null}

            {/* LoRAs */}
            {loras && loras.length > 0 ? (
              <div className="space-y-1.5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Layers className="h-3 w-3 inline mr-1" />
                  LoRAs ({loras.length})
                </h2>
                <div className="grid gap-2">
                  {loras.map((lora, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-muted/10 p-2.5"
                    >
                      {lora.previewImageUrl ? (
                        <img
                          src={lora.previewImageUrl}
                          alt=""
                          className="h-9 w-9 rounded object-cover"
                        />
                      ) : null}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {lora.name}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground">
                            Scale: {lora.scale}
                          </span>
                          {lora.triggerWords?.length ? (
                            <span className="text-xs text-muted-foreground/60">
                              Triggers: {lora.triggerWords.join(", ")}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
