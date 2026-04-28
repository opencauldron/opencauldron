"use client";

/**
 * Studio settings form. Saves via PATCH /api/workspaces/[id] so the
 * authoritative role gate stays on the API route (NFR-004).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface Props {
  workspace: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string;
  };
}

const SLUG_RE = /^[a-z0-9-]+$/;

export function StudioSettingsForm({ workspace }: Props) {
  const router = useRouter();
  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const [logoUrl, setLogoUrl] = useState(workspace.logoUrl);
  const [saving, setSaving] = useState(false);

  const dirty =
    name !== workspace.name ||
    slug !== workspace.slug ||
    logoUrl !== workspace.logoUrl;

  function validate(): string | null {
    const trimmedName = name.trim();
    if (!trimmedName) return "Name is required.";
    if (trimmedName.length > 80) return "Name must be 80 characters or fewer.";
    const trimmedSlug = slug.trim();
    if (!trimmedSlug) return "Slug is required.";
    if (trimmedSlug.length > 80) return "Slug must be 80 characters or fewer.";
    if (!SLUG_RE.test(trimmedSlug)) {
      return "Slug must be kebab-case (lowercase letters, numbers, dashes).";
    }
    const trimmedLogo = logoUrl.trim();
    if (trimmedLogo) {
      try {
        new URL(trimmedLogo);
      } catch {
        return "Logo URL must be a valid URL (or empty).";
      }
    }
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          logoUrl: logoUrl.trim() === "" ? null : logoUrl.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      toast.success("Studio updated.");
      // Refresh server components so the sidebar picks up the new name.
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-6">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-foreground">General</h2>
          <p className="text-xs text-muted-foreground">
            These settings are visible to everyone in your studio.
          </p>
        </div>

        <div className="grid gap-4 sm:max-w-md">
          <div className="space-y-1.5">
            <Label htmlFor="studio-name">Name</Label>
            <Input
              id="studio-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Studio"
              maxLength={80}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="studio-slug">Slug</Label>
            <Input
              id="studio-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="my-studio"
              maxLength={80}
              required
              pattern="[a-z0-9-]+"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and dashes only.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="studio-logo">Logo URL</Label>
            <Input
              id="studio-logo"
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
              maxLength={2048}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Optional. Leave blank to use the default logo.
            </p>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={!dirty || saving}>
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Saving
            </>
          ) : (
            "Save changes"
          )}
        </Button>
      </div>
    </form>
  );
}
