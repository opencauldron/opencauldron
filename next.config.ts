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
  output: "standalone",
  turbopack: {
    root: __dirname,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
};

export default nextConfig;
