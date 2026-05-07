"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OnboardingForm({
  defaultDisplayName,
  defaultWorkspaceName,
}: {
  defaultDisplayName: string;
  defaultWorkspaceName: string;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [workspaceName, setWorkspaceName] = useState(defaultWorkspaceName);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    displayName.trim().length > 0 &&
    workspaceName.trim().length > 0 &&
    acceptedTerms &&
    acceptedPrivacy &&
    !submitting;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim(),
          workspaceName: workspaceName.trim(),
          acceptedTerms: true,
          acceptedPrivacy: true,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          name="displayName"
          required
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={80}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="workspaceName">Workspace name</Label>
        <Input
          id="workspaceName"
          name="workspaceName"
          required
          value={workspaceName}
          onChange={(e) => setWorkspaceName(e.target.value)}
          maxLength={80}
        />
        <p className="text-xs text-muted-foreground">
          You can rename this later in Studio Settings.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={acceptedTerms}
          onChange={(e) => setAcceptedTerms(e.target.checked)}
          className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
          required
        />
        <span className="text-muted-foreground">
          I agree to the{" "}
          <Link
            href="/terms"
            target="_blank"
            className="underline hover:text-foreground"
          >
            Terms of Service
          </Link>
          .
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={acceptedPrivacy}
          onChange={(e) => setAcceptedPrivacy(e.target.checked)}
          className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
          required
        />
        <span className="text-muted-foreground">
          I have read the{" "}
          <Link
            href="/privacy"
            target="_blank"
            className="underline hover:text-foreground"
          >
            Privacy Policy
          </Link>
          .
        </span>
      </label>

      {error ? (
        <div className="rounded-lg bg-destructive/10 p-2 text-center text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={!canSubmit}
      >
        {submitting ? "Setting up…" : "Continue"}
      </Button>
    </form>
  );
}
