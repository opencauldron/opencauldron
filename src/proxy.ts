import { auth } from "@/lib/auth";

export const proxy = auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";
  const isAuthApi = req.nextUrl.pathname.startsWith("/api/auth");
  const isUploadsApi = req.nextUrl.pathname.startsWith("/api/uploads");
  // /api/health is the Docker / orchestrator liveness probe and must be
  // reachable without auth — the HEALTHCHECK has no session cookie.
  const isHealthApi = req.nextUrl.pathname === "/api/health";
  const isPublicBrew = req.nextUrl.pathname.startsWith("/brew/")
    || req.nextUrl.pathname.startsWith("/api/brews/explore")
    || req.nextUrl.pathname.startsWith("/api/brews/public/");

  // Dev-only login shortcut. The route handler does its own gate
  // (`NODE_ENV !== "production"` AND `DEV_LOGIN_ENABLED === "true"`); we
  // mirror the same guard here so the middleware passes through cleanly.
  // If either condition fails, the request falls through to the normal
  // auth flow and the route handler returns 404.
  const isDevLoginAllowed =
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_LOGIN_ENABLED === "true";
  const isDevLogin =
    isDevLoginAllowed && req.nextUrl.pathname === "/api/dev-login";

  // Allow auth API routes, local upload serving, the health probe, public
  // brew pages, and the dev-login shortcut when both env-checks permit it.
  if (isAuthApi || isUploadsApi || isHealthApi || isPublicBrew || isDevLogin) return;

  // Redirect unauthenticated users to login
  if (!isLoggedIn && !isLoginPage) {
    return Response.redirect(new URL("/login", req.nextUrl));
  }

  // Redirect authenticated users away from login
  if (isLoggedIn && isLoginPage) {
    return Response.redirect(new URL("/", req.nextUrl));
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logos/).*)"],
};
