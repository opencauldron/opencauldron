import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.onboardingCompletedAt) {
    redirect("/");
  }

  const email = session.user.email ?? "";
  const fallbackDisplayName =
    session.user.name?.trim() ||
    (email.includes("@") ? email.split("@")[0] : "") ||
    "";
  const firstName = fallbackDisplayName.split(/\s+/)[0] || "";
  const fallbackWorkspaceName = firstName
    ? `${firstName}'s Studio`
    : "My Studio";

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,oklch(0.22_0.06_280/0.25),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_100%,oklch(0.18_0.05_310/0.20),transparent_55%)]" />
      </div>

      <div className="relative z-10 w-full max-w-md px-4">
        <Card className="border-border/50 bg-card/80 shadow-2xl shadow-primary/5 ring-1 ring-primary/10 backdrop-blur-sm">
          <CardHeader className="space-y-2 text-center">
            <CardTitle className="font-heading text-2xl font-bold tracking-tight">
              Set up your studio
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Tell us what to call you and your workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <OnboardingForm
              defaultDisplayName={fallbackDisplayName}
              defaultWorkspaceName={fallbackWorkspaceName}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
