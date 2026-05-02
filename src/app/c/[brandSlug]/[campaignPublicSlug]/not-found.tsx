/**
 * 404 for the public campaign gallery (T011).
 *
 * No dashboard chrome, no sidebar — just a centered, minimal screen. Triggered
 * when:
 *   - the public_slug doesn't match any campaign
 *   - the campaign has been flipped back to private
 *   - the link was regenerated and the suffix on the URL is now stale
 *
 * Tone is matter-of-fact and short. Owners can regenerate or republish at any
 * time, so we don't try to explain the "why" — we just state that the link
 * isn't active.
 */

import { Link2Off } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center px-6 py-16">
      <div className="flex flex-col items-center text-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground ring-1 ring-foreground/10">
          <Link2Off className="size-6" strokeWidth={1.5} aria-hidden />
        </div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          This link is no longer active
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          The campaign you&rsquo;re trying to view isn&rsquo;t public anymore.
          If you were expecting access, ask the person who shared it to send a
          fresh link.
        </p>
      </div>
    </main>
  );
}
