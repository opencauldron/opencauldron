import { auth } from "@/lib/auth";
import { Wand2, Images, BarChart3, ArrowRight, Trophy } from "lucide-react";
import Link from "next/link";
import { LeaderboardPreview } from "@/components/leaderboard-preview";

const featureCards = [
  {
    title: "Generate",
    description: "Create stunning images with AI-powered models. Choose from multiple styles and fine-tune every detail.",
    href: "/generate",
    icon: Wand2,
    cta: "Start Creating",
    gradient: "from-primary/15 to-primary/5",
    iconBg: "bg-primary/15 text-primary",
    accentBorder: "hover:border-primary/30",
  },
  {
    title: "Gallery",
    description: "Browse, organize, and manage all your generated assets in one place. Search, filter, and download.",
    href: "/gallery",
    icon: Images,
    cta: "View Gallery",
    gradient: "from-violet-500/15 to-purple-500/5",
    iconBg: "bg-violet-500/15 text-violet-400",
    accentBorder: "hover:border-violet-500/30",
  },
  {
    title: "Usage",
    description: "Track your generation history, monitor API costs, and understand your usage patterns over time.",
    href: "/usage",
    icon: BarChart3,
    cta: "View Usage",
    gradient: "from-emerald-500/15 to-teal-500/5",
    iconBg: "bg-emerald-500/15 text-emerald-400",
    accentBorder: "hover:border-emerald-500/30",
  },
];

export default async function HomePage() {
  const session = await auth();
  const firstName = session?.user?.name?.split(" ")[0] ?? "there";

  const now = new Date();
  const hour = now.getHours();
  let timeGreeting = "Good evening";
  if (hour < 12) timeGreeting = "Good morning";
  else if (hour < 18) timeGreeting = "Good afternoon";

  const dateString = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-10">
      {/* Hero welcome section */}
      <div className="space-y-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
          {timeGreeting},{" "}
          <span className="bg-gradient-to-r from-[oklch(0.76_0.13_280)] to-[oklch(0.65_0.20_300)] bg-clip-text text-transparent">
            {firstName}
          </span>
        </h1>
        <p className="text-base text-muted-foreground">
          {dateString} &mdash; What will you create today?
        </p>
      </div>

      {/* Section label */}
      <div className="flex items-center gap-3">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-widest text-muted-foreground/70">
          Quick Actions
        </h2>
        <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
      </div>

      {/* Feature cards grid */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {featureCards.map((card) => (
          <Link key={card.href} href={card.href} className="group block">
            <div
              className={`relative overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br ${card.gradient} p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-black/20 ${card.accentBorder}`}
            >
              {/* Icon */}
              <div
                className={`mb-4 flex h-11 w-11 items-center justify-center rounded-lg ${card.iconBg}`}
              >
                <card.icon className="h-5 w-5" />
              </div>

              {/* Content */}
              <h3 className="font-heading text-lg font-semibold tracking-tight">
                {card.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {card.description}
              </p>

              {/* CTA */}
              <div className="mt-5 flex items-center gap-1.5 text-sm font-medium text-primary transition-colors group-hover:text-primary/80">
                {card.cta}
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-1" />
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Leaderboard section */}
      <div className="flex items-center gap-3">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-widest text-muted-foreground/70">
          Leaderboard
        </h2>
        <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-primary" />
          <span className="font-heading text-sm font-semibold">
            Top Generators This Month
          </span>
        </div>
        <LeaderboardPreview />
      </div>
    </div>
  );
}
