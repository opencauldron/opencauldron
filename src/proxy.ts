import { auth } from "@/lib/auth";

export const proxy = auth((req) => {
  const isLoggedIn = !!req.auth;
  const path = req.nextUrl.pathname;
  const isLoginPage = path === "/login";
  const isAuthApi = path.startsWith("/api/auth");
  const isUploadsApi = path.startsWith("/api/uploads");
  // /api/health is the Docker / orchestrator liveness probe and must be
  // reachable without auth — the HEALTHCHECK has no session cookie.
  const isHealthApi = path === "/api/health";
  const isPublicBrew = path.startsWith("/brew/")
    || path.startsWith("/api/brews/explore")
    || path.startsWith("/api/brews/public/");
  const isLegalPage = path === "/terms" || path === "/privacy";
  const isOnboardingPage = path === "/onboarding";
  const isOnboardingApi = path.startsWith("/api/onboarding");

  // Dev-only login shortcut. The route handler does its own gate
  // (`NODE_ENV !== "production"` AND `DEV_LOGIN_ENABLED === "true"`); we
  // mirror the same guard here so the middleware passes through cleanly.
  // If either condition fails, the request falls through to the normal
  // auth flow and the route handler returns 404.
  const isDevLoginAllowed =
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_LOGIN_ENABLED === "true";
  const isDevLogin =
    isDevLoginAllowed && path === "/api/dev-login";

  // Allow auth API routes, local upload serving, the health probe, public
  // brew pages, public legal pages, and the dev-login shortcut when both
  // env-checks permit it.
  if (
    isAuthApi ||
    isUploadsApi ||
    isHealthApi ||
    isPublicBrew ||
    isDevLogin ||
    isLegalPage
  )
    return;

  // Redirect unauthenticated users to login
  if (!isLoggedIn && !isLoginPage) {
    return Response.redirect(new URL("/login", req.nextUrl));
  }

  // Redirect authenticated users away from login
  if (isLoggedIn && isLoginPage) {
    return Response.redirect(new URL("/", req.nextUrl));
  }

  // Onboarding gate — only enforced for the hosted (public SaaS) deployment.
  // Self-hosted installs leave `onboardingCompletedAt` null forever and
  // skip the redirect; bootstrap CLI is the equivalent for them.
  if (isLoggedIn && process.env.WORKSPACE_MODE === "hosted") {
    const completedAt = req.auth?.user?.onboardingCompletedAt;
    const onboardingDone = completedAt != null;

    if (!onboardingDone && !isOnboardingPage && !isOnboardingApi) {
      return Response.redirect(new URL("/onboarding", req.nextUrl));
    }
    if (onboardingDone && isOnboardingPage) {
      return Response.redirect(new URL("/", req.nextUrl));
    }
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logos/).*)"],
};
