"use client";

/**
 * Asset upload dropzone (T121 / US6 / FR-006).
 *
 * Drag-and-drop OR click-to-select multipart uploads to `POST /api/uploads`.
 * Brand-agnostic — the parent owns brand selection so this component is reusable
 * under both `/gallery` and the future `/brands/[slug]/gallery` route.
 *
 * Uses `XMLHttpRequest` (not `fetch`) so `xhr.upload.onprogress` can surface real
 * bytes-uploaded. Validates type/size client-side against the same allowlist the
 * server uses, but still surfaces the server's 400 / 413 errors in case the
 * client check is bypassed. One summary toast per batch — not per file.
 */

import { useCallback, useId, useRef, useState } from "react";
import { UploadCloud, X, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_TYPES = [
  "image/png", "image/jpeg", "image/webp", "image/gif",
  "video/mp4", "video/quicktime", "video/webm",
];

const SERVER_ERRORS: Record<string, string> = {
  file_too_large: "File too large (server)",
  unsupported_type: "Unsupported type",
  no_workspace: "No studio",
  forbidden: "Not allowed for this brand",
  brand_not_found: "Brand not found",
  personal_brand_missing: "Personal brand missing",
  no_file: "Missing file",
};

export interface UploadedAsset {
  id: string;
  brandId: string;
  status: "draft";
  mediaType: "image" | "video";
  url: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
  fileSize: number;
  createdAt: string;
}

interface UploadDropzoneProps {
  brandId: string | null;
  onUploaded?: (asset: UploadedAsset) => void;
  className?: string;
}

type ItemState =
  | { phase: "uploading"; progress: number; xhr: XMLHttpRequest }
  | { phase: "success" }
  | { phase: "error"; message: string };

interface UploadItem { key: string; name: string; size: number; state: ItemState }

export function UploadDropzone({ brandId, onUploaded, className }: UploadDropzoneProps) {
  const inputId = useId();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const disabled = brandId === null;

  const patchItem = useCallback(
    (key: string, fn: (prev: UploadItem) => UploadItem) =>
      setItems((prev) => prev.map((it) => (it.key === key ? fn(it) : it))),
    []
  );

  const upload = useCallback(
    (file: File, key: string, brand: string) =>
      new Promise<UploadedAsset | null>((resolve) => {
        const form = new FormData();
        form.append("file", file);
        form.append("brandId", brand);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/uploads");
        xhr.upload.addEventListener("progress", (e) => {
          if (!e.lengthComputable) return;
          const progress = Math.round((e.loaded / e.total) * 100);
          patchItem(key, (p) => p.state.phase === "uploading" ? { ...p, state: { ...p.state, progress } } : p);
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const { asset } = JSON.parse(xhr.responseText) as { asset: UploadedAsset };
              patchItem(key, (p) => ({ ...p, state: { phase: "success" } }));
              resolve(asset);
            } catch {
              patchItem(key, (p) => ({ ...p, state: { phase: "error", message: "Bad response" } }));
              resolve(null);
            }
            return;
          }
          let message = `Upload failed (${xhr.status})`;
          try {
            const body = JSON.parse(xhr.responseText) as { error?: string };
            if (body.error) message = SERVER_ERRORS[body.error] ?? body.error;
          } catch { /* keep default */ }
          patchItem(key, (p) => ({ ...p, state: { phase: "error", message } }));
          resolve(null);
        });
        xhr.addEventListener("error", () => {
          patchItem(key, (p) => ({ ...p, state: { phase: "error", message: "Network error" } }));
          resolve(null);
        });
        xhr.addEventListener("abort", () => {
          patchItem(key, (p) => ({ ...p, state: { phase: "error", message: "Cancelled" } }));
          resolve(null);
        });
        patchItem(key, (p) => ({ ...p, state: { phase: "uploading", progress: 0, xhr } }));
        xhr.send(form);
      }),
    [patchItem]
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!brandId) return;
      const list = Array.from(files);
      if (list.length === 0) return;

      const queued: { file: File; key: string }[] = [];
      const newItems: UploadItem[] = [];
      const rejections: string[] = [];

      for (const file of list) {
        const key = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`;
        const error =
          !ALLOWED_TYPES.includes(file.type) ? "Unsupported file type" :
          file.size > MAX_BYTES ? "Exceeds 50MB limit" : null;
        if (error) {
          rejections.push(`${file.name}: ${error}`);
          newItems.push({ key, name: file.name, size: file.size, state: { phase: "error", message: error } });
        } else {
          // placeholder XHR; real one is attached when upload() runs
          newItems.push({ key, name: file.name, size: file.size, state: { phase: "uploading", progress: 0, xhr: new XMLHttpRequest() } });
          queued.push({ file, key });
        }
      }

      setItems((prev) => [...newItems, ...prev]);
      if (rejections.length > 0) {
        toast.error(rejections.length === 1 ? rejections[0] : `${rejections.length} files rejected`);
      }
      if (queued.length === 0) return;

      const results = await Promise.all(queued.map(({ file, key }) => upload(file, key, brandId)));
      const successes = results.filter((r): r is UploadedAsset => r !== null);
      successes.forEach((a) => onUploaded?.(a));
      if (successes.length > 0) {
        toast.success(successes.length === 1 ? "Uploaded 1 file" : `Uploaded ${successes.length} files`);
      }
    },
    [brandId, onUploaded, upload]
  );

  const cancelItem = (key: string) => {
    setItems((prev) => {
      const it = prev.find((i) => i.key === key);
      if (it && it.state.phase === "uploading") it.state.xhr.abort();
      return prev.filter((i) => i.key !== key);
    });
  };

  // Depth-counter avoids flicker when dragging over child elements.
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    dragDepth.current += 1;
    setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (disabled) return;
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  };

  return (
    <div className={cn("space-y-3", className)}>
      <label
        htmlFor={inputId}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        aria-disabled={disabled}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
          "border-border bg-muted/20 hover:bg-muted/40",
          "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
          isDragging && !disabled && "border-primary bg-primary/5 ring-2 ring-primary/40",
          disabled && "cursor-not-allowed opacity-60 hover:bg-muted/20"
        )}
      >
        <UploadCloud
          className={cn("size-8", isDragging && !disabled ? "text-primary" : "text-muted-foreground")}
          aria-hidden
        />
        <div className="space-y-0.5">
          <p className="text-sm font-medium">
            {disabled ? "Pick a brand to upload" : isDragging ? "Drop to upload" : "Drag files here, or click to browse"}
          </p>
          <p className="text-xs text-muted-foreground">
            PNG, JPG, WebP, GIF, MP4, MOV, WebM up to 50MB
          </p>
        </div>
        <input
          id={inputId}
          type="file"
          multiple
          accept={ALLOWED_TYPES.join(",")}
          disabled={disabled}
          className="sr-only"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleFiles(e.target.files);
              e.target.value = ""; // re-pick same file should re-trigger change
            }
          }}
        />
      </label>

      {items.length > 0 && (
        <ul className="space-y-1.5" aria-label="Uploads">
          {items.map((item) => <UploadRow key={item.key} item={item} onCancel={() => cancelItem(item.key)} />)}
        </ul>
      )}
    </div>
  );
}

function UploadRow({ item, onCancel }: { item: UploadItem; onCancel: () => void }) {
  const { state } = item;
  return (
    <li className="flex items-center gap-3 rounded-md border border-border/60 bg-card px-3 py-2 text-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium" title={item.name}>{item.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatSize(item.size)}</span>
        </div>
        {state.phase === "uploading" && (
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={state.progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full bg-primary transition-[width] duration-150 ease-out" style={{ width: `${state.progress}%` }} />
          </div>
        )}
        {state.phase === "error" && (
          <span className="text-xs text-rose-600 dark:text-rose-300">{state.message}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {state.phase === "uploading" && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
        {state.phase === "success" && <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-300" aria-hidden />}
        {state.phase === "error" && <AlertCircle className="size-4 text-rose-600 dark:text-rose-300" aria-hidden />}
        {state.phase !== "success" && (
          <button
            type="button"
            onClick={onCancel}
            aria-label={state.phase === "uploading" ? `Cancel upload of ${item.name}` : `Dismiss ${item.name}`}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </li>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
