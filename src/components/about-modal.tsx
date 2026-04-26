"use client";

import { Copy, Info } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const REPO_URL = "https://github.com/opencauldron/opencauldron";
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

interface AboutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AboutModal({ open, onOpenChange }: AboutModalProps) {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown";
  const studioName =
    process.env.NEXT_PUBLIC_STUDIO_NAME ??
    process.env.NEXT_PUBLIC_ORG_NAME ??
    "OpenCauldron";

  const handleCopyDebug = async () => {
    const info = {
      app: studioName,
      version,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      url: typeof window !== "undefined" ? window.location.href : "",
      locale:
        typeof navigator !== "undefined" ? navigator.language : "",
      timestamp: new Date().toISOString(),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(info, null, 2));
      toast.success("Debug info copied");
    } catch {
      toast.error("Failed to copy debug info");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            About {studioName}
          </DialogTitle>
          <DialogDescription>
            Open source AI media generation studio.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="font-medium">{version}</dd>

          <dt className="text-muted-foreground">Source code</dt>
          <dd>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-3 hover:text-primary/80"
            >
              github.com/opencauldron/opencauldron
            </a>
          </dd>

          <dt className="text-muted-foreground">License</dt>
          <dd>
            <a
              href={LICENSE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-3 hover:text-primary/80"
            >
              Sustainable Use License v1.0
            </a>
          </dd>

          <dt className="text-muted-foreground">Debug</dt>
          <dd>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyDebug}
              className="h-7 gap-1.5 text-xs"
            >
              <Copy className="h-3 w-3" />
              Copy debug info
            </Button>
          </dd>
        </dl>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
