"use client";

import { useState } from "react";
import { Wand, Wand2, WandSparkles } from "lucide-react";

/* ─────────────────────── Proposed Color Tokens ─────────────────────── */

const proposedTheme = {
  "--background": "oklch(0.12 0.02 280)",
  "--foreground": "oklch(0.94 0.008 280)",
  "--card": "oklch(0.16 0.02 280)",
  "--card-foreground": "oklch(0.94 0.008 280)",
  "--popover": "oklch(0.16 0.02 280)",
  "--popover-foreground": "oklch(0.94 0.008 280)",
  "--primary": "oklch(0.68 0.19 280)",
  "--primary-foreground": "oklch(0.98 0.005 280)",
  "--secondary": "oklch(0.20 0.02 280)",
  "--secondary-foreground": "oklch(0.90 0.01 280)",
  "--muted": "oklch(0.22 0.015 280)",
  "--muted-foreground": "oklch(0.58 0.025 280)",
  "--accent": "oklch(0.22 0.025 300)",
  "--accent-foreground": "oklch(0.94 0.008 280)",
  "--destructive": "oklch(0.65 0.20 25)",
  "--border": "oklch(0.26 0.025 280)",
  "--input": "oklch(0.22 0.02 280)",
  "--ring": "oklch(0.68 0.19 280)",
  "--chart-1": "oklch(0.68 0.19 280)",
  "--chart-2": "oklch(0.65 0.18 310)",
  "--chart-3": "oklch(0.70 0.14 250)",
  "--chart-4": "oklch(0.62 0.13 340)",
  "--chart-5": "oklch(0.58 0.14 200)",
  "--sidebar": "oklch(0.14 0.022 280)",
  "--sidebar-foreground": "oklch(0.90 0.01 280)",
  "--sidebar-primary": "oklch(0.68 0.19 280)",
  "--sidebar-primary-foreground": "oklch(0.98 0.005 280)",
  "--sidebar-accent": "oklch(0.18 0.02 280)",
  "--sidebar-accent-foreground": "oklch(0.90 0.01 280)",
  "--sidebar-border": "oklch(0.24 0.025 280)",
  "--sidebar-ring": "oklch(0.68 0.19 280)",
} as Record<string, string>;

/* ─────────────────────── Extended Palette ─────────────────────── */

const palette = {
  core: [
    { name: "Indigo 50", value: "oklch(0.97 0.02 280)", hex: "#F0EEFF", usage: "Lightest tints, hover fills" },
    { name: "Indigo 100", value: "oklch(0.92 0.04 280)", hex: "#DDD8FF", usage: "Subtle backgrounds" },
    { name: "Indigo 200", value: "oklch(0.84 0.08 280)", hex: "#BDB2FF", usage: "Muted borders" },
    { name: "Indigo 300", value: "oklch(0.76 0.13 280)", hex: "#9B8AFF", usage: "Hover states" },
    { name: "Indigo 400", value: "oklch(0.68 0.19 280)", hex: "#7C5CFC", usage: "Primary (buttons, links, focus)" },
    { name: "Indigo 500", value: "oklch(0.58 0.22 280)", hex: "#6238E0", usage: "Active / pressed" },
    { name: "Indigo 600", value: "oklch(0.48 0.22 280)", hex: "#4C1FC4", usage: "Deep emphasis" },
    { name: "Indigo 700", value: "oklch(0.38 0.20 280)", hex: "#3A1296", usage: "Dark surfaces" },
    { name: "Indigo 800", value: "oklch(0.28 0.14 280)", hex: "#281068", usage: "Near-black overlays" },
    { name: "Indigo 900", value: "oklch(0.18 0.08 280)", hex: "#160A3A", usage: "Deepest backgrounds" },
  ],
  accents: [
    { name: "Violet", value: "oklch(0.65 0.20 300)", hex: "#A855F7", usage: "Secondary actions, highlights" },
    { name: "Fuchsia", value: "oklch(0.68 0.20 325)", hex: "#E040A0", usage: "Creative accents, sparkle" },
    { name: "Sky", value: "oklch(0.72 0.14 240)", hex: "#60A5FA", usage: "Info, links, data viz" },
    { name: "Teal", value: "oklch(0.70 0.12 195)", hex: "#2DD4BF", usage: "Success, positive states" },
    { name: "Rose", value: "oklch(0.65 0.18 10)", hex: "#FB7185", usage: "Warnings, destructive" },
  ],
  surfaces: [
    { name: "Void", value: "oklch(0.10 0.025 280)", hex: "#0D0A1A", usage: "Deepest background" },
    { name: "Abyss", value: "oklch(0.12 0.02 280)", hex: "#110E22", usage: "Page background" },
    { name: "Obsidian", value: "oklch(0.16 0.02 280)", hex: "#1A1530", usage: "Card / popover" },
    { name: "Slate", value: "oklch(0.22 0.015 280)", hex: "#252040", usage: "Muted / input" },
    { name: "Haze", value: "oklch(0.28 0.02 280)", hex: "#332C52", usage: "Borders, dividers" },
  ],
};

/* ─────────────────────── Logo Variants ─────────────────────── */

/** Styled icon container used for all logo marks */
function LogoMark({
  size = 36,
  children,
  className = "",
}: {
  size?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center rounded-xl bg-gradient-to-br from-[oklch(0.50_0.22_280)] to-[oklch(0.40_0.20_300)] shadow-lg shadow-[oklch(0.68_0.19_280/0.25)] ${className}`}
      style={{ width: size, height: size }}
    >
      {children}
    </div>
  );
}

/** Active logo used throughout the styleguide */
function AppLogo({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <LogoMark size={size} className={className}>
      <WandSparkles size={Math.round(size * 0.5)} strokeWidth={1.5} className="text-white" />
    </LogoMark>
  );
}

/* ─────────────────────── Shimmer / Sparkle effects ─────────────────────── */

function FloatingSparkles() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: 18 }).map((_, i) => (
        <div
          key={i}
          className="sparkle-dot absolute rounded-full"
          style={{
            width: `${2 + Math.random() * 3}px`,
            height: `${2 + Math.random() * 3}px`,
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            background: `oklch(0.75 0.15 ${260 + Math.random() * 60})`,
            animationDelay: `${Math.random() * 6}s`,
            animationDuration: `${3 + Math.random() * 4}s`,
          }}
        />
      ))}
    </div>
  );
}

/* ─────────────────────── Logo Card ─────────────────────── */

function LogoCard({
  label,
  title,
  description,
  recommended,
  children,
}: {
  label: string;
  title: string;
  description: string;
  recommended: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="group relative flex flex-col items-center gap-4 overflow-hidden rounded-2xl p-8 ring-1 transition-all duration-300 hover:ring-2"
      style={{
        background: "var(--card)",
        "--tw-ring-color": recommended ? "oklch(0.68 0.19 280 / 0.5)" : "var(--border)",
      } as React.CSSProperties}
    >
      {/* Glow for recommended */}
      {recommended && (
        <div className="pointer-events-none absolute inset-0 opacity-15" style={{ background: "radial-gradient(circle at 50% 40%, oklch(0.68 0.19 280), transparent 70%)" }} />
      )}
      {/* Label badge */}
      <div className="absolute left-3 top-3 flex items-center gap-2">
        <span
          className="inline-flex h-5 items-center rounded-full px-2 text-[10px] font-bold uppercase"
          style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
        >
          {label}
        </span>
        {recommended && (
          <span
            className="inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold"
            style={{ background: "oklch(0.68 0.19 280 / 0.15)", color: "oklch(0.76 0.13 280)" }}
          >
            Recommended
          </span>
        )}
      </div>
      <div className="relative mt-4">{children}</div>
      <div className="relative text-center">
        <p className="font-heading text-base font-bold" style={{ color: "var(--foreground)" }}>{title}</p>
        <p className="mt-1 max-w-[240px] text-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
          {description}
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────── Section wrapper ─────────────────────── */

function Section({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-8">
        <h2 className="font-heading text-2xl font-bold tracking-tight" style={{ color: "var(--foreground)" }}>
          {title}
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
          {subtitle}
        </p>
      </div>
      {children}
    </section>
  );
}

/* ─────────────────────── Color Swatch ─────────────────────── */

function Swatch({ name, value, hex, usage }: { name: string; value: string; hex: string; usage: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      onClick={copy}
      className="group flex flex-col items-start gap-2 text-left transition-transform duration-200 hover:-translate-y-1"
    >
      <div
        className="relative h-16 w-full overflow-hidden rounded-xl ring-1 ring-white/10 transition-shadow duration-200 group-hover:shadow-lg group-hover:shadow-[oklch(0.68_0.19_280/0.2)]"
        style={{ background: value }}
      >
        {copied && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-medium text-white backdrop-blur-sm">
            Copied!
          </div>
        )}
      </div>
      <div>
        <p className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>{name}</p>
        <p className="font-mono text-[10px]" style={{ color: "var(--muted-foreground)" }}>{hex}</p>
        <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{usage}</p>
      </div>
    </button>
  );
}

/* ─────────────────────── Component Previews ─────────────────────── */

function ButtonPreview() {
  return (
    <div className="flex flex-wrap gap-3">
      <button
        className="inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all hover:opacity-90 active:translate-y-px"
        style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
      >
        <SparkleIcon /> Primary
      </button>
      <button
        className="inline-flex h-9 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-all hover:opacity-80 active:translate-y-px"
        style={{ borderColor: "var(--border)", color: "var(--foreground)", background: "transparent" }}
      >
        Outline
      </button>
      <button
        className="inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all hover:opacity-80 active:translate-y-px"
        style={{ background: "var(--secondary)", color: "var(--secondary-foreground)" }}
      >
        Secondary
      </button>
      <button
        className="inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all hover:opacity-80 active:translate-y-px"
        style={{ background: "transparent", color: "var(--foreground)" }}
      >
        Ghost
      </button>
      <button
        className="inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all hover:opacity-80 active:translate-y-px"
        style={{ background: "oklch(0.65 0.20 25 / 0.15)", color: "oklch(0.70 0.18 25)" }}
      >
        Destructive
      </button>
      {/* Gradient magic button */}
      <button className="shimmer-btn relative inline-flex h-9 items-center gap-2 overflow-hidden rounded-lg px-5 text-sm font-semibold text-white transition-all active:translate-y-px">
        <span className="relative z-10 flex items-center gap-2">
          <SparkleIcon /> Magic
        </span>
      </button>
    </div>
  );
}

function CardPreview() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* Standard card */}
      <div
        className="group flex flex-col gap-3 rounded-xl p-4 ring-1 transition-all duration-300 hover:ring-2"
        style={{
          background: "var(--card)",
          color: "var(--card-foreground)",
          "--tw-ring-color": "var(--border)",
        } as React.CSSProperties}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ background: "oklch(0.68 0.19 280 / 0.15)" }}
          >
            <WandIcon />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Generate</p>
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Create with AI</p>
          </div>
        </div>
        <p className="text-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
          Type a prompt and watch the magic happen. Multiple models, instant results.
        </p>
      </div>

      {/* Glowing card */}
      <div
        className="glow-card group relative flex flex-col gap-3 overflow-hidden rounded-xl p-4 ring-1 transition-all duration-300"
        style={{
          background: "var(--card)",
          color: "var(--card-foreground)",
          "--tw-ring-color": "oklch(0.68 0.19 280 / 0.3)",
        } as React.CSSProperties}
      >
        <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-30 blur-2xl" style={{ background: "oklch(0.68 0.19 280)" }} />
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ background: "oklch(0.65 0.20 300 / 0.15)" }}
          >
            <GalleryIcon />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Gallery</p>
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Browse creations</p>
          </div>
        </div>
        <p className="text-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
          A living gallery of everything your team has conjured up. Filter, search, iterate.
        </p>
      </div>

      {/* Stat card */}
      <div
        className="flex flex-col justify-between gap-4 rounded-xl p-4 ring-1"
        style={{
          background: "var(--card)",
          color: "var(--card-foreground)",
          "--tw-ring-color": "var(--border)",
        } as React.CSSProperties}
      >
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
          Images Generated
        </p>
        <p className="font-heading text-4xl font-bold tabular-nums" style={{ color: "var(--primary)" }}>
          2,847
        </p>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "oklch(0.70 0.12 195 / 0.15)", color: "oklch(0.70 0.12 195)" }}>
            +12.4%
          </span>
          <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>vs last week</span>
        </div>
      </div>
    </div>
  );
}

function BadgePreview() {
  return (
    <div className="flex flex-wrap gap-2">
      <span
        className="inline-flex h-5 items-center rounded-full px-2.5 text-xs font-medium"
        style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
      >
        Primary
      </span>
      <span
        className="inline-flex h-5 items-center rounded-full px-2.5 text-xs font-medium"
        style={{ background: "var(--secondary)", color: "var(--secondary-foreground)" }}
      >
        Secondary
      </span>
      <span
        className="inline-flex h-5 items-center rounded-full border px-2.5 text-xs font-medium"
        style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
      >
        Outline
      </span>
      <span
        className="inline-flex h-5 items-center rounded-full px-2.5 text-xs font-medium"
        style={{ background: "oklch(0.65 0.20 300 / 0.15)", color: "oklch(0.70 0.18 300)" }}
      >
        Violet
      </span>
      <span
        className="inline-flex h-5 items-center rounded-full px-2.5 text-xs font-medium"
        style={{ background: "oklch(0.70 0.12 195 / 0.15)", color: "oklch(0.70 0.12 195)" }}
      >
        Success
      </span>
      <span
        className="inline-flex h-5 items-center rounded-full px-2.5 text-xs font-medium"
        style={{ background: "oklch(0.65 0.20 25 / 0.15)", color: "oklch(0.70 0.18 25)" }}
      >
        Destructive
      </span>
    </div>
  );
}

function InputPreview() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" style={{ color: "var(--foreground)" }}>Text Input</label>
        <input
          type="text"
          placeholder="Describe your vision..."
          className="h-9 rounded-lg border px-3 text-sm outline-none transition-all placeholder:text-[var(--muted-foreground)] focus:ring-2"
          style={{
            background: "var(--input)",
            borderColor: "var(--border)",
            color: "var(--foreground)",
            "--tw-ring-color": "oklch(0.68 0.19 280 / 0.5)",
          } as React.CSSProperties}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" style={{ color: "var(--foreground)" }}>Select</label>
        <select
          className="h-9 rounded-lg border px-3 text-sm outline-none transition-all focus:ring-2"
          style={{
            background: "var(--input)",
            borderColor: "var(--border)",
            color: "var(--foreground)",
            "--tw-ring-color": "oklch(0.68 0.19 280 / 0.5)",
          } as React.CSSProperties}
        >
          <option>Flux Pro</option>
          <option>Imagen 4</option>
          <option>Gemini Nano</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label className="text-xs font-medium" style={{ color: "var(--foreground)" }}>Textarea</label>
        <textarea
          rows={3}
          placeholder="A magical forest illuminated by bioluminescent mushrooms, cinematic lighting, 8k..."
          className="rounded-lg border px-3 py-2 text-sm outline-none transition-all placeholder:text-[var(--muted-foreground)] focus:ring-2"
          style={{
            background: "var(--input)",
            borderColor: "var(--border)",
            color: "var(--foreground)",
            "--tw-ring-color": "oklch(0.68 0.19 280 / 0.5)",
          } as React.CSSProperties}
        />
      </div>
    </div>
  );
}

function SidebarPreview() {
  const items = [
    { label: "Generate", active: true },
    { label: "Gallery", active: false },
    { label: "Brands", active: false },
    { label: "Usage", active: false },
  ];

  return (
    <div
      className="w-64 overflow-hidden rounded-xl ring-1"
      style={{ background: "var(--sidebar)", "--tw-ring-color": "var(--sidebar-border)" } as React.CSSProperties}
    >
      {/* Header */}
      <div className="relative border-b px-4 py-4" style={{ borderColor: "var(--sidebar-border)" }}>
        <div
          className="absolute inset-x-0 top-0 h-[2px]"
          style={{ background: "linear-gradient(to right, transparent, oklch(0.68 0.19 280 / 0.8), transparent)" }}
        />
        <div className="flex items-center gap-3">
          <AppLogo size={36} />
          <div>
            <p className="font-heading text-base font-bold" style={{ color: "var(--sidebar-foreground)" }}>Cauldron</p>
            <p className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>
              Studio
            </p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <div className="px-2 py-3">
        <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>
          Navigation
        </p>
        {items.map((item) => (
          <div
            key={item.label}
            className="mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all"
            style={
              item.active
                ? {
                    background: "oklch(0.68 0.19 280 / 0.12)",
                    color: "oklch(0.76 0.15 280)",
                    borderLeft: "2px solid oklch(0.68 0.19 280)",
                    fontWeight: 500,
                  }
                : {
                    color: "var(--sidebar-foreground)",
                    borderLeft: "2px solid transparent",
                  }
            }
          >
            <div className="h-4 w-4 rounded" style={{ background: item.active ? "oklch(0.68 0.19 280 / 0.3)" : "var(--muted)" }} />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────── Chart Preview ─────────────────────── */

function ChartPreview() {
  const data = [
    { label: "Mon", value: 65, color: "var(--chart-1)" },
    { label: "Tue", value: 82, color: "var(--chart-2)" },
    { label: "Wed", value: 45, color: "var(--chart-3)" },
    { label: "Thu", value: 93, color: "var(--chart-4)" },
    { label: "Fri", value: 71, color: "var(--chart-5)" },
  ];
  const max = 100;

  return (
    <div className="flex items-end gap-3" style={{ height: 120 }}>
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center gap-2">
          <div
            className="w-full rounded-t-md transition-all duration-500"
            style={{
              height: `${(d.value / max) * 100}px`,
              background: d.color,
              opacity: 0.85,
            }}
          />
          <span className="text-[10px] font-medium" style={{ color: "var(--muted-foreground)" }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────── Small Icon Components ─────────────────────── */

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  );
}

function WandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="oklch(0.68 0.19 280)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 4V2" /><path d="M15 16v-2" /><path d="M8 9h2" /><path d="M20 9h2" /><path d="M17.8 11.8 19 13" /><path d="M15 9h.01" /><path d="M17.8 6.2 19 5" /><path d="m3 21 9-9" /><path d="M12.2 6.2 11 5" />
    </svg>
  );
}

function GalleryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="oklch(0.65 0.20 300)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

/* ─────────────────────── Token Comparison Table ─────────────────────── */

function TokenTable() {
  const tokens = [
    { name: "--primary", current: "oklch(0.68 0.19 280)", proposed: "Indigo 400", label: "Buttons, links, focus" },
    { name: "--background", current: "oklch(0.12 0.02 280)", proposed: "Abyss", label: "Page background" },
    { name: "--card", current: "oklch(0.16 0.02 280)", proposed: "Obsidian", label: "Card / popover" },
    { name: "--ring", current: "oklch(0.68 0.19 280)", proposed: "Indigo 400", label: "Focus ring" },
    { name: "--border", current: "oklch(0.26 0.025 280)", proposed: "Haze", label: "Borders, dividers" },
    { name: "--muted", current: "oklch(0.22 0.015 280)", proposed: "Slate", label: "Muted backgrounds" },
    { name: "--accent", current: "oklch(0.22 0.025 300)", proposed: "Violet-tinged", label: "Accent surfaces" },
  ];

  return (
    <div className="overflow-hidden rounded-xl ring-1" style={{ "--tw-ring-color": "var(--border)" } as React.CSSProperties}>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ background: "var(--muted)" }}>
            <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--foreground)" }}>Token</th>
            <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--foreground)" }}>Value</th>
            <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--foreground)" }}>Name</th>
            <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--foreground)" }}>Purpose</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => (
            <tr key={t.name} className="border-t" style={{ borderColor: "var(--border)" }}>
              <td className="px-3 py-2 font-mono" style={{ color: "var(--muted-foreground)" }}>{t.name}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded" style={{ background: t.current }} />
                  <span className="font-mono" style={{ color: "var(--muted-foreground)" }}>{t.current}</span>
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded" style={{ background: t.proposed }} />
                  <span className="font-mono" style={{ color: "var(--foreground)" }}>{t.proposed}</span>
                </div>
              </td>
              <td className="px-3 py-2" style={{ color: "var(--muted-foreground)" }}>{t.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────── Main Page ─────────────────────── */

const navLinks = [
  { label: "Logo", href: "#logo" },
  { label: "Colors", href: "#colors" },
  { label: "Typography", href: "#typography" },
  { label: "Components", href: "#components" },
  { label: "Tokens", href: "#tokens" },
];

export default function StyleguidePage() {
  return (
    <div className="dark" style={proposedTheme}>
      {/* Page background */}
      <div
        className="relative min-h-screen"
        style={{
          background: "var(--background)",
          color: "var(--foreground)",
        }}
      >
        {/* Atmospheric gradient overlays */}
        <div className="pointer-events-none fixed inset-0 z-0">
          <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 15% 0%, oklch(0.20 0.06 280 / 0.25), transparent 55%)" }} />
          <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 85% 100%, oklch(0.18 0.05 310 / 0.18), transparent 55%)" }} />
          <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 50% 40%, oklch(0.15 0.03 260 / 0.10), transparent 60%)" }} />
        </div>

        <FloatingSparkles />

        {/* Sticky nav */}
        <nav
          className="sticky top-0 z-50 border-b backdrop-blur-xl"
          style={{
            borderColor: "var(--border)",
            background: "oklch(0.12 0.02 280 / 0.8)",
          }}
        >
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
            <div className="flex items-center gap-2.5">
              <AppLogo size={28} />
              <span className="font-heading text-sm font-bold tracking-tight" style={{ color: "var(--foreground)" }}>
                Style Guide
              </span>
              <span
                className="ml-1.5 inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wide"
                style={{ background: "oklch(0.68 0.19 280 / 0.15)", color: "oklch(0.76 0.15 280)" }}
              >
                Draft
              </span>
            </div>
            <div className="hidden items-center gap-1 sm:flex">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 hover:bg-white/5"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </nav>

        {/* Hero */}
        <div className="relative z-10 mx-auto max-w-5xl px-6 pb-8 pt-16">
          <div className="hero-entrance flex flex-col items-center text-center">
            <div className="relative mb-6">
              <div
                className="absolute -inset-4 animate-pulse rounded-full opacity-30 blur-2xl"
                style={{ background: "oklch(0.68 0.19 280)" }}
              />
              <AppLogo size={72} className="relative" />
            </div>
            <h1
              className="font-heading text-4xl font-extrabold tracking-tight sm:text-5xl"
              style={{
                background: "linear-gradient(135deg, oklch(0.80 0.12 280), oklch(0.68 0.19 280), oklch(0.65 0.20 310))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Cauldron Design System
            </h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
              Proposed magical indigo theme with wand identity.
              <br />
              Colors, typography, and components for your review.
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="relative z-10 mx-auto max-w-5xl space-y-20 px-6 pb-24">

          {/* ─── Logo ─── */}
          <Section id="logo" title="Logo & Identity" subtitle="Emoji vs Lucide icons — pick the right mark">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {/* Option A — Emoji */}
              <LogoCard
                label="A"
                title="Emoji 🪄"
                description="Native emoji in a gradient container. Zero dependencies, instantly recognizable, fun."
                recommended={false}
              >
                <LogoMark size={72}>
                  <span style={{ fontSize: 36, lineHeight: 1 }}>🪄</span>
                </LogoMark>
              </LogoCard>

              {/* Option B — WandSparkles */}
              <LogoCard
                label="B"
                title="WandSparkles"
                description="Lucide WandSparkles icon. Wand with star accents — the most detailed of the three."
                recommended={true}
              >
                <LogoMark size={72}>
                  <WandSparkles size={36} strokeWidth={1.5} className="text-white" />
                </LogoMark>
              </LogoCard>

              {/* Option C — Wand2 */}
              <LogoCard
                label="C"
                title="Wand2"
                description="Lucide Wand2 — already used for Generate nav item. Clean with small star accents."
                recommended={false}
              >
                <LogoMark size={72}>
                  <Wand2 size={36} strokeWidth={1.5} className="text-white" />
                </LogoMark>
              </LogoCard>

              {/* Option D — Wand */}
              <LogoCard
                label="D"
                title="Wand"
                description="Lucide Wand — simplest version. Just the wand, no stars. Most minimal."
                recommended={false}
              >
                <LogoMark size={72}>
                  <Wand size={36} strokeWidth={1.5} className="text-white" />
                </LogoMark>
              </LogoCard>
            </div>

            {/* Size scaling for the recommended option */}
            <div className="mt-8">
              <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--foreground)" }}>Size Scaling — Emoji (favicon → sidebar → hero)</h3>
              <div
                className="flex items-end gap-6 rounded-2xl p-6 ring-1"
                style={{ background: "var(--card)", "--tw-ring-color": "var(--border)" } as React.CSSProperties}
              >
                {[20, 28, 36, 48, 64].map((s) => (
                  <div key={s} className="flex flex-col items-center gap-2">
                    <LogoMark size={s}>
                      <span style={{ fontSize: Math.round(s * 0.5), lineHeight: 1 }}>🪄</span>
                    </LogoMark>
                    <span className="font-mono text-[10px]" style={{ color: "var(--muted-foreground)" }}>{s}px</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Lucide size scaling for comparison */}
            <div className="mt-4">
              <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--foreground)" }}>Size Scaling — WandSparkles (for comparison)</h3>
              <div
                className="flex items-end gap-6 rounded-2xl p-6 ring-1"
                style={{ background: "var(--card)", "--tw-ring-color": "var(--border)" } as React.CSSProperties}
              >
                {[20, 28, 36, 48, 64].map((s) => (
                  <div key={s} className="flex flex-col items-center gap-2">
                    <LogoMark size={s}>
                      <WandSparkles size={Math.round(s * 0.5)} strokeWidth={1.5} className="text-white" />
                    </LogoMark>
                    <span className="font-mono text-[10px]" style={{ color: "var(--muted-foreground)" }}>{s}px</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          {/* ─── Colors ─── */}
          <Section id="colors" title="Color Palette" subtitle="OKLCH-based indigo system with accent companions">
            <div className="space-y-10">
              {/* Core indigo scale */}
              <div>
                <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--foreground)" }}>Core Indigo Scale</h3>
                <div className="grid grid-cols-5 gap-3 sm:grid-cols-10">
                  {palette.core.map((c) => (
                    <Swatch key={c.name} {...c} />
                  ))}
                </div>
              </div>

              {/* Accent colors */}
              <div>
                <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--foreground)" }}>Accent Colors</h3>
                <div className="grid grid-cols-5 gap-3">
                  {palette.accents.map((c) => (
                    <Swatch key={c.name} {...c} />
                  ))}
                </div>
              </div>

              {/* Surface colors */}
              <div>
                <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--foreground)" }}>Surface Colors</h3>
                <div className="grid grid-cols-5 gap-3">
                  {palette.surfaces.map((c) => (
                    <Swatch key={c.name} {...c} />
                  ))}
                </div>
              </div>
            </div>
          </Section>

          {/* ─── Typography ─── */}
          <Section id="typography" title="Typography" subtitle="Plus Jakarta Sans for headings, Inter for body">
            <div
              className="space-y-6 rounded-2xl p-8 ring-1"
              style={{ background: "var(--card)", "--tw-ring-color": "var(--border)" } as React.CSSProperties}
            >
              <div className="space-y-4">
                <h1 className="font-heading text-4xl font-extrabold tracking-tight" style={{ color: "var(--foreground)" }}>
                  Heading 1 — Bold Vision
                </h1>
                <h2 className="font-heading text-3xl font-bold tracking-tight" style={{ color: "var(--foreground)" }}>
                  Heading 2 — Creative Power
                </h2>
                <h3 className="font-heading text-2xl font-semibold" style={{ color: "var(--foreground)" }}>
                  Heading 3 — Magical Details
                </h3>
                <h4 className="font-heading text-xl font-semibold" style={{ color: "var(--foreground)" }}>
                  Heading 4 — Subtle Craft
                </h4>
              </div>
              <hr style={{ borderColor: "var(--border)" }} />
              <div className="max-w-2xl space-y-3">
                <p className="text-sm leading-relaxed" style={{ color: "var(--foreground)" }}>
                  <strong>Body (sm)</strong> — Every pixel tells a story. Our design system channels the energy of creation — vivid indigo as the north star, supported by a cast of accent colors that bring warmth and wonder to every interaction.
                </p>
                <p className="text-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
                  <strong>Caption (xs)</strong> — Subtle text for descriptions, metadata, and secondary information. Muted but legible.
                </p>
                <p className="font-mono text-xs" style={{ color: "oklch(0.68 0.19 280)" }}>
                  <strong>Mono</strong> — Code, tokens, and technical details. oklch(0.68 0.19 280)
                </p>
              </div>
              <hr style={{ borderColor: "var(--border)" }} />
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
                  Gradient Text Effect
                </p>
                <p
                  className="font-heading text-3xl font-extrabold"
                  style={{
                    background: "linear-gradient(135deg, oklch(0.80 0.12 260), oklch(0.68 0.19 280), oklch(0.65 0.20 310), oklch(0.68 0.20 325))",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  Create something extraordinary.
                </p>
              </div>
            </div>
          </Section>

          {/* ─── Components ─── */}
          <Section id="components" title="Components" subtitle="Core UI building blocks in the new theme">
            <div className="space-y-10">
              {/* Buttons */}
              <div>
                <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--foreground)" }}>Buttons</h3>
                <div
                  className="rounded-2xl p-6 ring-1"
                  style={{ background: "var(--card)", "--tw-ring-color": "var(--border)" } as React.CSSProperties}
                >
                  <ButtonPreview />
                </div>
              </div>

              {/* Badges */}
              <div>
                <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--foreground)" }}>Badges</h3>
                <div
                  className="rounded-2xl p-6 ring-1"
                  style={{ background: "var(--card)", "--tw-ring-color": "var(--border)" } as React.CSSProperties}
                >
                  <BadgePreview />
                </div>
              </div>

              {/* Cards */}
              <div>
                <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--foreground)" }}>Cards</h3>
                <CardPreview />
              </div>

              {/* Inputs */}
              <div>
                <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--foreground)" }}>Form Controls</h3>
                <div
                  className="rounded-2xl p-6 ring-1"
                  style={{ background: "var(--card)", "--tw-ring-color": "var(--border)" } as React.CSSProperties}
                >
                  <InputPreview />
                </div>
              </div>

              {/* Sidebar Preview */}
              <div>
                <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--foreground)" }}>Sidebar</h3>
                <SidebarPreview />
              </div>

              {/* Chart Colors */}
              <div>
                <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--foreground)" }}>Chart Colors</h3>
                <div
                  className="rounded-2xl p-6 ring-1"
                  style={{ background: "var(--card)", "--tw-ring-color": "var(--border)" } as React.CSSProperties}
                >
                  <ChartPreview />
                </div>
              </div>
            </div>
          </Section>

          {/* ─── Token Comparison ─── */}
          <Section id="tokens" title="Design Tokens" subtitle="Core semantic tokens and their OKLCH values">
            <TokenTable />
          </Section>
        </div>

        {/* Footer */}
        <footer
          className="relative z-10 border-t py-8 text-center"
          style={{ borderColor: "var(--border)" }}
        >
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            Style Guide — Cauldron Studio
          </p>
        </footer>
      </div>

      {/* Scoped styles */}
      <style>{`
        @keyframes sparkle-float {
          0%, 100% { opacity: 0; transform: translateY(0) scale(0.8); }
          50% { opacity: 0.8; transform: translateY(-30px) scale(1.2); }
        }

        .sparkle-dot {
          animation: sparkle-float 5s ease-in-out infinite;
        }

        @keyframes hero-entrance {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .hero-entrance {
          animation: hero-entrance 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .shimmer-btn {
          background: linear-gradient(135deg,
            oklch(0.58 0.22 280),
            oklch(0.65 0.20 300),
            oklch(0.68 0.19 280),
            oklch(0.60 0.22 260)
          );
          background-size: 300% 300%;
          animation: shimmer-shift 3s ease-in-out infinite;
        }

        .shimmer-btn:hover {
          box-shadow: 0 0 24px oklch(0.68 0.19 280 / 0.4);
        }

        @keyframes shimmer-shift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        .glow-card:hover {
          box-shadow: 0 0 32px oklch(0.68 0.19 280 / 0.15);
        }

        /* Smooth scroll */
        html { scroll-behavior: smooth; }
      `}</style>
    </div>
  );
}
