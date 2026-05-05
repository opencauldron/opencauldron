import type { NextConfig } from "next";
import pkg from "./package.json";

// ----------------------------------------------------------------------------
// Build-time defense-in-depth for the dev-login bypass (`/api/dev-login`).
//
// The route is gated by TWO env checks at request time (`NODE_ENV !==
// "production"` AND `DEV_LOGIN_ENABLED === "true"`) — but a misconfigured
// production deploy that leaks `DEV_LOGIN_ENABLED=true` would still be a
// catastrophic surface. This check fails the BUILD itself in that case so
// the bad config can't land at all.
// ----------------------------------------------------------------------------
if (
  process.env.NODE_ENV === "production" &&
  process.env.DEV_LOGIN_ENABLED === "true"
) {
  throw new Error(
    "[next.config.ts] DEV_LOGIN_ENABLED=true is set in a production build. " +
      "This flag must NEVER be true in production — it activates an unauthenticated " +
      "session-mint route. Remove DEV_LOGIN_ENABLED from your production environment."
  );
}

const nextConfig: NextConfig = {
  // `standalone` produces a minimal Node server bundle for self-hosted
  // (Docker) deploys. Vercel needs Next.js's default output to wire up
  // serverless functions correctly, so skip standalone when building there.
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  turbopack: {
    root: __dirname,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  // --------------------------------------------------------------------------
  // Public campaign galleries (`/c/<brandSlug>/<campaignPublicSlug>`).
  //
  // - X-Robots-Tag: prevent search engines from indexing public gallery URLs
  //   (FR-008). The page also emits a <meta name="robots"> tag at the RSC
  //   level for belt-and-suspenders — see specs/public-campaign-galleries.
  // - Cache-Control: let Vercel's edge cache absorb viral spikes (NFR-002).
  //   60s fresh + 5min stale-while-revalidate is short enough that
  //   visibility flips and regenerates take effect quickly via
  //   `revalidatePath`, while still cushioning bursts.
  // --------------------------------------------------------------------------
  async headers() {
    return [
      {
        source: "/c/:brandSlug/:slug*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          {
            key: "Cache-Control",
            value: "public, s-maxage=60, stale-while-revalidate=300",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
