import { signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const ORG_NAME = process.env.NEXT_PUBLIC_ORG_NAME;
const ORG_LOGO = process.env.NEXT_PUBLIC_ORG_LOGO;
const ORG_URL = process.env.NEXT_PUBLIC_ORG_URL;
const STUDIO_NAME = process.env.NEXT_PUBLIC_STUDIO_NAME;

const SPARKLES = Array.from({ length: 14 }, (_, i) => ({
  size: 2 + (i % 3),
  left: 6 + i * 6.5,
  top: 8 + ((i * 19) % 84),
  hue: 260 + i * 7,
  duration: 3 + (i % 4),
  delay: i * 0.4,
}));

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const hasOrg = !!ORG_NAME;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background">
      {/* Gradient background layers */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,oklch(0.22_0.06_280/0.25),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_100%,oklch(0.18_0.05_310/0.20),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,oklch(0.20_0.04_280/0.10),transparent_65%)]" />
      </div>

      {/* Floating sparkle particles */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {SPARKLES.map((s, i) => (
          <div
            key={i}
            className="sparkle absolute rounded-full"
            style={{
              width: `${s.size}px`,
              height: `${s.size}px`,
              left: `${s.left}%`,
              top: `${s.top}%`,
              background: `oklch(0.75 0.15 ${s.hue}deg)`,
              animationDuration: `${s.duration}s`,
              animationDelay: `${s.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Login card */}
      <div className="login-entrance relative z-10 w-full max-w-md px-4">
        <Card className="border-border/50 bg-card/80 shadow-2xl shadow-primary/5 ring-1 ring-primary/10 backdrop-blur-sm">
          <CardHeader className="space-y-4 pb-2 text-center">
            {hasOrg ? (
              <>
                {/* Org-branded: logo + org name, studio name as hero */}
                {ORG_LOGO && (
                  <div className="flex items-center justify-center gap-2.5">
                    <img
                      src={ORG_LOGO}
                      alt={ORG_NAME!}
                      className="h-8 w-8 rounded-lg"
                    />
                    <span className="text-sm font-medium text-muted-foreground">
                      {ORG_NAME}
                    </span>
                  </div>
                )}
                {!ORG_LOGO && (
                  <p className="text-sm font-medium text-muted-foreground">
                    {ORG_NAME}
                  </p>
                )}
                <div className="space-y-1.5">
                  <CardTitle className="font-heading text-3xl font-bold tracking-tight">
                    {STUDIO_NAME ?? ORG_NAME}
                  </CardTitle>
                  <CardDescription className="text-sm text-muted-foreground">
                    Conjure stunning media with a wave of your wand.
                  </CardDescription>
                </div>
              </>
            ) : (
              <>
                {/* Default: OpenCauldron branding */}
                <div className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[oklch(0.50_0.22_280)] to-[oklch(0.40_0.20_300)] shadow-lg shadow-primary/25">
                  <WandIcon />
                </div>
                <div className="space-y-1.5">
                  <CardTitle className="font-heading text-3xl font-bold tracking-tight">
                    OpenCauldron
                  </CardTitle>
                  <CardDescription className="text-sm text-muted-foreground">
                    Conjure stunning media with a wave of your wand.
                  </CardDescription>
                </div>
              </>
            )}
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <LoginContent searchParams={searchParams} />
          </CardContent>
        </Card>

        {/* Footer: "Powered by" or org link */}
        <div className="login-entrance-footer mt-5 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/40">
          {hasOrg ? (
            <a
              href="https://opencauldron.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-muted-foreground/60 transition-colors"
            >
              <div className="flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-[oklch(0.50_0.22_280)] to-[oklch(0.40_0.20_300)]">
                <WandIcon className="h-2.5 w-2.5" />
              </div>
              Powered by OpenCauldron
            </a>
          ) : null}
        </div>
      </div>

      <style>{`
        @keyframes loginEntrance {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .login-entrance {
          animation: loginEntrance 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .login-entrance-footer {
          animation: loginEntrance 0.4s cubic-bezier(0.16, 1, 0.3, 1) 0.3s forwards;
          opacity: 0;
        }
        @keyframes sparklePulse {
          0%, 100% { opacity: 0.15; transform: scale(0.8); }
          50% { opacity: 0.7; transform: scale(1.3); }
        }
        .sparkle {
          animation: sparklePulse ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

async function LoginContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <>
      {error && (
        <div className="rounded-lg bg-destructive/10 p-3 text-center text-sm text-destructive">
          {error === "AccessDenied"
            ? "Access denied. You are not authorized to sign in."
            : "An error occurred. Please try again."}
        </div>
      )}
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <Button type="submit" className="w-full" size="lg">
          <GoogleIcon />
          Sign in with Google
        </Button>
      </form>
      <p className="text-center text-xs text-muted-foreground">
        Sign in with your Google account to get started
      </p>
    </>
  );
}

function WandIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-white ${className}`}
    >
      <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
      <path d="m14 7 3 3" />
      <path d="M5 6v4" />
      <path d="M19 14v4" />
      <path d="M10 2v2" />
      <path d="M7 8H3" />
      <path d="M21 16h-4" />
      <path d="M11 3H9" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
