"use client";

/**
 * Brand kit editor (T060). Minimum-viable form: name, color, prefix/suffix,
 * banned-terms list, video toggle, self-approval toggle. Edits PATCH
 * `/api/brands/[id]`. Brand_manager+ can edit; others see a read-only view.
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

interface BrandSummary {
  id: string;
  name: string;
  color: string;
  promptPrefix: string | null;
  promptSuffix: string | null;
  bannedTerms: string[];
  defaultLoraId: string | null;
  videoEnabled: boolean;
  selfApprovalAllowed: boolean;
  isPersonal: boolean;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function BrandKitEditor({
  brand,
  canEdit,
}: {
  brand: BrandSummary;
  canEdit: boolean;
}) {
  const [color, setColor] = useState(brand.color);
  const [promptPrefix, setPromptPrefix] = useState(brand.promptPrefix ?? "");
  const [promptSuffix, setPromptSuffix] = useState(brand.promptSuffix ?? "");
  const [bannedTerms, setBannedTerms] = useState<string[]>(brand.bannedTerms);
  const [bannedTermDraft, setBannedTermDraft] = useState("");
  const [defaultLoraId, setDefaultLoraId] = useState(brand.defaultLoraId ?? "");
  const [videoEnabled, setVideoEnabled] = useState(brand.videoEnabled);
  const [selfApprovalAllowed, setSelfApprovalAllowed] = useState(
    brand.selfApprovalAllowed
  );
  const [saving, setSaving] = useState(false);

  const disabled = !canEdit;
  const colorValid = HEX_RE.test(color);

  function addBannedTerm() {
    const term = bannedTermDraft.trim();
    if (!term) return;
    if (bannedTerms.includes(term)) return;
    setBannedTerms([...bannedTerms, term]);
    setBannedTermDraft("");
  }

  function removeBannedTerm(term: string) {
    setBannedTerms(bannedTerms.filter((t) => t !== term));
  }

  async function save() {
    if (!canEdit) return;
    if (!colorValid) {
      toast.error("Color must be a #RRGGBB hex value");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/brands/${brand.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          color,
          promptPrefix: promptPrefix.trim() || null,
          promptSuffix: promptSuffix.trim() || null,
          bannedTerms,
          defaultLoraId: defaultLoraId.trim() || null,
          videoEnabled,
          selfApprovalAllowed,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to save");
        return;
      }
      toast.success("Brand kit saved");
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {!canEdit && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
          Read-only view — only brand managers and workspace admins can edit
          the kit.
        </p>
      )}

      <section className="space-y-2">
        <Label htmlFor="brand-color">Color</Label>
        <div className="flex items-center gap-3">
          <span
            className="h-8 w-8 rounded-md border border-border/60"
            style={{ backgroundColor: colorValid ? color : "transparent" }}
          />
          <Input
            id="brand-color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            disabled={disabled}
            className="w-32 font-mono"
          />
        </div>
        {!colorValid && (
          <p className="text-xs text-rose-400">Use #RRGGBB.</p>
        )}
      </section>

      <section className="space-y-2">
        <Label htmlFor="brand-prefix">Prompt prefix</Label>
        <Textarea
          id="brand-prefix"
          rows={2}
          value={promptPrefix}
          onChange={(e) => setPromptPrefix(e.target.value)}
          disabled={disabled}
          placeholder="e.g. studio shot,"
        />
      </section>

      <section className="space-y-2">
        <Label htmlFor="brand-suffix">Prompt suffix</Label>
        <Textarea
          id="brand-suffix"
          rows={2}
          value={promptSuffix}
          onChange={(e) => setPromptSuffix(e.target.value)}
          disabled={disabled}
          placeholder="e.g. , clean, well-lit"
        />
      </section>

      <section className="space-y-2">
        <Label>Banned terms</Label>
        <div className="flex flex-wrap gap-1.5">
          {bannedTerms.length === 0 && (
            <span className="text-xs text-muted-foreground">No banned terms.</span>
          )}
          {bannedTerms.map((term) => (
            <span
              key={term}
              className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs"
            >
              {term}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeBannedTerm(term)}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Remove banned term ${term}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
          ))}
        </div>
        {!disabled && (
          <div className="flex gap-2">
            <Input
              value={bannedTermDraft}
              onChange={(e) => setBannedTermDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addBannedTerm();
                }
              }}
              placeholder="Add a term"
              className="max-w-xs"
            />
            <Button type="button" variant="outline" onClick={addBannedTerm}>
              Add
            </Button>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <Label htmlFor="brand-default-lora">Default LoRA id (optional)</Label>
        <Input
          id="brand-default-lora"
          value={defaultLoraId}
          onChange={(e) => setDefaultLoraId(e.target.value)}
          disabled={disabled}
          placeholder="e.g. lora_xyz"
        />
      </section>

      {!brand.isPersonal && (
        <>
          <section className="flex items-center gap-3">
            <Switch
              id="video-enabled"
              checked={videoEnabled}
              onCheckedChange={setVideoEnabled}
              disabled={disabled}
            />
            <Label htmlFor="video-enabled" className="cursor-pointer">
              Enable video generation for this brand
            </Label>
          </section>

          <section className="flex items-center gap-3">
            <Switch
              id="self-approve"
              checked={selfApprovalAllowed}
              onCheckedChange={setSelfApprovalAllowed}
              disabled={disabled}
            />
            <Label htmlFor="self-approve" className="cursor-pointer">
              Allow brand managers to self-approve their own assets
            </Label>
          </section>
        </>
      )}

      {!disabled && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving || !colorValid}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      )}
    </div>
  );
}
