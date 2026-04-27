"use client";

// Add Brand dialog (T138). Parent (sidebar) gates the trigger to admins/owners.
// POSTs `{ name, slug? (kebab-case), color (HEX) }` to /api/brands. Slug
// auto-derives from name until the user types in it; blank slug is omitted so
// the server slugifies. 201 → onAdded + close, 409/400/403 → inline error.

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AddedBrand {
  id: string; name: string; slug: string | null; color: string; isPersonal: boolean;
}
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded?: (brand: AddedBrand) => void;
}

const SLUG_RE = /^[a-z0-9-]+$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = "#6366f1";

const deriveSlug = (n: string) =>
  n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

export function AddBrandDialog({ open, onOpenChange, onAdded }: Props) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Reset on open so a half-typed slug or stale error never resurrects.
  useEffect(() => {
    if (!open) return;
    setName(""); setSlug(""); setSlugTouched(false);
    setColor(DEFAULT_COLOR); setSubmitting(false); setServerError(null);
  }, [open]);

  const trimmedName = name.trim();
  const slugDisplay = slugTouched ? slug : deriveSlug(trimmedName);
  const slugForSubmit = slugTouched ? slug.trim() : "";

  const nameError = trimmedName.length > 100 ? "Name must be 100 characters or fewer." : null;
  const slugError =
    slugTouched && slugForSubmit.length > 0 && !SLUG_RE.test(slugForSubmit)
      ? "Slug must be lowercase letters, numbers, and dashes."
      : null;
  const colorError = HEX_RE.test(color) ? null : "Color must be a 6-digit HEX (e.g. #6366f1).";
  const canSubmit =
    !submitting && trimmedName.length > 0 && !nameError && !slugError && !colorError;

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setServerError(null);

    const payload: { name: string; slug?: string; color: string } = { name: trimmedName, color };
    if (slugForSubmit.length > 0) payload.slug = slugForSubmit;

    try {
      const res = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 201) {
        const brand = (await res.json()) as AddedBrand;
        toast.success(`Created ${brand.name}`);
        onAdded?.(brand);
        onOpenChange(false);
        return;
      }
      if (res.status === 409) {
        setServerError("A brand with that name or slug is already taken.");
      } else if (res.status === 400) {
        const data = await res.json().catch(() => ({}));
        setServerError(typeof data?.error === "string" ? data.error : "Invalid input.");
      } else if (res.status === 403) {
        setServerError("Only workspace admins can create brands.");
      } else {
        setServerError("Something went wrong. Please try again.");
      }
    } catch {
      setServerError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4" aria-hidden />
              Add brand
            </DialogTitle>
            <DialogDescription>
              Create a new brand workspace. You can configure the brand kit later.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="add-brand-name">Name</Label>
              <Input
                id="add-brand-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme Coffee Co."
                autoFocus
                maxLength={100}
                aria-invalid={nameError ? true : undefined}
              />
              {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="add-brand-slug">
                Slug <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="add-brand-slug"
                value={slugDisplay}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
                placeholder="acme-coffee-co"
                maxLength={80}
                aria-invalid={slugError ? true : undefined}
              />
              <p className={`text-xs ${slugError ? "text-destructive" : "text-muted-foreground"}`}>
                {slugError ?? "Used in URLs. Lowercase letters, numbers, and dashes only."}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="add-brand-color">Color</Label>
              <div className="flex items-center gap-2">
                <label
                  htmlFor="add-brand-color-picker"
                  className="relative size-8 shrink-0 cursor-pointer rounded-lg ring-1 ring-foreground/10 transition-shadow hover:ring-foreground/25"
                  style={{ backgroundColor: HEX_RE.test(color) ? color : "transparent" }}
                  aria-label="Pick color"
                >
                  <input
                    id="add-brand-color-picker"
                    type="color"
                    value={HEX_RE.test(color) ? color : DEFAULT_COLOR}
                    onChange={(e) => setColor(e.target.value)}
                    className="absolute inset-0 size-full cursor-pointer opacity-0"
                  />
                </label>
                <Input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="#6366f1"
                  maxLength={7}
                  className="font-mono"
                  aria-invalid={colorError ? true : undefined}
                />
              </div>
              {colorError ? <p className="text-xs text-destructive">{colorError}</p> : null}
            </div>

            {serverError ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {serverError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={submitting} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Create brand
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
