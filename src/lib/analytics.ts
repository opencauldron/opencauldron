/**
 * Minimal analytics helper.
 *
 * The codebase does not currently wire PostHog (no `posthog-js` dependency,
 * no provider). This helper exists so feature code can call
 * `trackEvent("asset_downloaded", { ... })` without branching, and the call
 * silently no-ops in environments where no analytics SDK is present.
 *
 * When PostHog is wired up later, it typically attaches itself to
 * `window.posthog`. The helper checks for that and forwards via
 * `posthog.capture(...)`. No other transport is supported yet — keep this
 * helper boring; it is intentionally a one-line shim.
 */

type AnalyticsProps = Record<string, unknown>;

interface PosthogLike {
  capture: (eventName: string, props?: AnalyticsProps) => void;
}

interface WindowWithPosthog extends Window {
  posthog?: PosthogLike;
}

export function trackEvent(name: string, props: AnalyticsProps = {}): void {
  if (typeof window === "undefined") return;

  const ph = (window as WindowWithPosthog).posthog;
  if (ph && typeof ph.capture === "function") {
    try {
      ph.capture(name, props);
    } catch {
      // Swallow analytics errors — telemetry must never break product flows.
    }
  }
}
