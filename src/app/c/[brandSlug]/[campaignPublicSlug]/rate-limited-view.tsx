/**
 * Friendly rate-limited screen (T020).
 *
 * Rendered by the public page RSC when `checkAndConsumeIpRateLimit` returns
 * `{ ok: false }`. RSCs can't surface arbitrary HTTP status codes so we render
 * a calm, informational page rather than a 429. The number of seconds until
 * the window opens up is shown in plain copy.
 */

import { TimerReset } from "lucide-react";

interface RateLimitedViewProps {
  retryAfterSeconds: number;
}

export function RateLimitedView({ retryAfterSeconds }: RateLimitedViewProps) {
  const seconds = Math.max(1, retryAfterSeconds);

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center px-6 py-16">
      <div className="flex flex-col items-center text-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground ring-1 ring-foreground/10">
          <TimerReset className="size-6" strokeWidth={1.5} aria-hidden />
        </div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          Too many requests
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          You&rsquo;re reloading this page faster than we can serve it. Try
          again in {seconds} {seconds === 1 ? "second" : "seconds"}.
        </p>
      </div>
    </main>
  );
}
