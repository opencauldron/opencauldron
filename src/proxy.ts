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

  // Allow auth API routes, local upload serving, the health probe, and
  // public brew pages.
  if (isAuthApi || isUploadsApi || isHealthApi || isPublicBrew) return;

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
