#!/usr/bin/env node

/**
 * Interactive fork-setup wizard. Run AFTER cloning the repo:
 *
 *   git clone https://github.com/opencauldron/opencauldron.git my-studio
 *   cd my-studio && pnpm install && pnpm setup
 *
 * This is for forkers who want their own studio on top of OpenCauldron.
 * For run-as-is self-hosting, use the Docker quickstart in the README —
 * you don't need this script.
 *
 * What it does:
 *   1. Asks about database / storage / providers / studio name.
 *   2. Writes `.env.local` derived from `.env.example`.
 *
 * Things it does NOT do (intentionally):
 *   - Clone the repo (you already did).
 *   - Install dependencies (you already did).
 *   - `git init` a fresh history (run `rm -rf .git && git init` yourself
 *     if you want that — opinionated detach is a footgun).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import * as p from "@clack/prompts";
import pc from "picocolors";

const PROVIDERS = [
  {
    group: "Image Models",
    items: [
      { value: "GEMINI_API_KEY", label: "Google Gemini", hint: "Imagen 4, Flash, Flash Lite" },
      { value: "XAI_API_KEY", label: "xAI Grok", hint: "Grok Imagine, Grok Pro" },
      { value: "BFL_API_KEY", label: "Black Forest Labs", hint: "Flux Pro 1.1, Flux Dev" },
      { value: "IDEOGRAM_API_KEY", label: "Ideogram", hint: "Ideogram 3" },
      { value: "RECRAFT_API_KEY", label: "Recraft", hint: "Recraft V3, Recraft 20B" },
    ],
  },
  {
    group: "Video Models",
    items: [
      { value: "GEMINI_API_KEY", label: "Google Veo 3", hint: "uses Gemini key", disabled: true },
      { value: "RUNWAY_API_KEY", label: "Runway", hint: "Gen-4 Turbo" },
      { value: "FAL_KEY", label: "Kling", hint: "Kling 2.1 via fal.ai" },
      { value: "MINIMAX_API_KEY", label: "MiniMax", hint: "Hailuo 2.3" },
      { value: "LUMA_API_KEY", label: "Luma AI", hint: "Ray 2" },
    ],
  },
  {
    group: "Tools",
    items: [
      { value: "MISTRAL_API_KEY", label: "Mistral", hint: "prompt enhancement" },
    ],
  },
];

const ALL_PROVIDER_ITEMS = PROVIDERS.flatMap((g) => g.items).filter((i) => !i.disabled);

function cancelled() {
  p.cancel("Setup cancelled.");
  process.exit(0);
}

async function main() {
  const cwd = process.cwd();
  const envExamplePath = resolve(cwd, ".env.example");
  const envLocalPath = resolve(cwd, ".env.local");

  console.log();
  p.intro(`${pc.magenta(pc.bold("✦ OpenCauldron"))}  ${pc.dim("studio setup")}`);

  if (!existsSync(envExamplePath)) {
    p.cancel("Couldn't find .env.example — are you running this from the repo root?");
    process.exit(1);
  }

  if (existsSync(envLocalPath)) {
    const overwrite = await p.confirm({
      message: ".env.local already exists. Overwrite it?",
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) cancelled();
  }

  // ── Studio name (optional branding) ──────────────────────────────────

  const studioName = await p.text({
    message: "Studio name (used for branding, optional)",
    placeholder: "Acme Studio",
    defaultValue: "",
  });
  if (p.isCancel(studioName)) cancelled();
  const displayName = String(studioName).trim();

  // ── Database ─────────────────────────────────────────────────────────

  const dbChoice = await p.select({
    message: "Database",
    options: [
      { value: "docker", label: "Local Postgres", hint: "docker compose up db -d" },
      { value: "neon", label: "Neon", hint: "serverless Postgres" },
      { value: "skip", label: "Skip — I'll set DATABASE_URL myself" },
    ],
  });
  if (p.isCancel(dbChoice)) cancelled();

  let neonUrl = "";
  if (dbChoice === "neon") {
    neonUrl = await p.text({
      message: "Neon connection string",
      placeholder: "postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require",
      validate: (v) => {
        if (!v.includes("neon.tech")) return "Doesn't look like a Neon URL";
      },
    });
    if (p.isCancel(neonUrl)) cancelled();
  }

  // ── Storage ──────────────────────────────────────────────────────────

  const storageChoice = await p.select({
    message: "Storage",
    options: [
      { value: "local", label: "Local filesystem", hint: "saves to ./uploads/" },
      { value: "r2", label: "Cloudflare R2", hint: "production storage" },
    ],
  });
  if (p.isCancel(storageChoice)) cancelled();

  let r2Config = {};
  if (storageChoice === "r2") {
    const r2 = await p.group({
      accountId: () => p.text({ message: "R2 Account ID" }),
      accessKeyId: () => p.text({ message: "R2 Access Key ID" }),
      secretAccessKey: () => p.text({ message: "R2 Secret Access Key" }),
      bucketName: () => p.text({ message: "R2 Bucket Name", placeholder: "cauldron", defaultValue: "cauldron" }),
    });
    if (p.isCancel(r2)) cancelled();
    r2Config = r2;
  }

  // ── AI providers ─────────────────────────────────────────────────────

  p.note(
    PROVIDERS.map((g) =>
      `${pc.bold(g.group)}\n${g.items.map((i) =>
        `  ${i.disabled ? pc.dim("↳") : "•"} ${i.label} ${pc.dim(`— ${i.hint}`)}`
      ).join("\n")}`
    ).join("\n\n"),
    "Available models"
  );

  const selectedKeys = await p.multiselect({
    message: "Which providers do you want to enable?",
    options: [...new Set(ALL_PROVIDER_ITEMS.map((i) => i.value))].map((key) => {
      const items = ALL_PROVIDER_ITEMS.filter((i) => i.value === key);
      const label = items.map((i) => i.label).join(", ");
      const hint = items.map((i) => i.hint).join(", ");
      return { value: key, label, hint: pc.dim(hint) };
    }),
    required: false,
  });
  if (p.isCancel(selectedKeys)) cancelled();

  const apiKeys = {};
  for (const key of selectedKeys) {
    const items = ALL_PROVIDER_ITEMS.filter((i) => i.value === key);
    const label = items.map((i) => i.label).join(" / ");
    const value = await p.password({
      message: `${label} API key`,
      validate: (v) => {
        if (!v.trim()) return "API key is required (or go back and deselect this provider)";
      },
    });
    if (p.isCancel(value)) cancelled();
    apiKeys[key] = value;
  }

  // ── Generate .env.local ──────────────────────────────────────────────

  const s = p.spinner();
  s.start("Generating .env.local");

  let env = readFileSync(envExamplePath, "utf8");

  if (dbChoice === "neon") {
    env = env.replace(
      /DATABASE_URL="[^"]*"/,
      `DATABASE_URL="${neonUrl}"`
    );
  } else if (dbChoice === "docker") {
    env = env.replace(
      /DATABASE_URL="[^"]*"/,
      'DATABASE_URL="postgresql://cauldron:cauldron@localhost:5432/cauldron"'
    );
  }
  // dbChoice === "skip" → leave the example value in place

  const secret = randomBytes(32).toString("base64");
  env = env.replace(/NEXTAUTH_SECRET="[^"]*"/, `NEXTAUTH_SECRET="${secret}"`);

  if (storageChoice === "r2") {
    env = env.replace(/^STORAGE_PROVIDER="[^"]*"/m, 'STORAGE_PROVIDER="r2"');
    env = env.replace(/^# ?R2_ACCOUNT_ID="[^"]*"/m, `R2_ACCOUNT_ID="${r2Config.accountId}"`);
    env = env.replace(/^# ?R2_ACCESS_KEY_ID="[^"]*"/m, `R2_ACCESS_KEY_ID="${r2Config.accessKeyId}"`);
    env = env.replace(/^# ?R2_SECRET_ACCESS_KEY="[^"]*"/m, `R2_SECRET_ACCESS_KEY="${r2Config.secretAccessKey}"`);
    env = env.replace(/^# ?R2_BUCKET_NAME="[^"]*"/m, `R2_BUCKET_NAME="${r2Config.bucketName}"`);
  }

  if (displayName) {
    if (/^# ?NEXT_PUBLIC_ORG_NAME="[^"]*"/m.test(env)) {
      env = env.replace(
        /^# ?NEXT_PUBLIC_ORG_NAME="[^"]*".*/m,
        `NEXT_PUBLIC_ORG_NAME="${displayName}"`
      );
    } else {
      env += `\nNEXT_PUBLIC_ORG_NAME="${displayName}"\n`;
    }
  }

  for (const [key, value] of Object.entries(apiKeys)) {
    const re = new RegExp(`^# ?${key}="[^"]*"`, "m");
    if (re.test(env)) {
      env = env.replace(re, `${key}="${value}"`);
    } else {
      env += `\n${key}="${value}"\n`;
    }
  }

  writeFileSync(envLocalPath, env);
  s.stop("Wrote .env.local");

  // ── Summary ──────────────────────────────────────────────────────────

  const summary = [
    `${pc.bold("Studio")}     ${displayName || pc.dim("(unnamed)")}`,
    `${pc.bold("Database")}   ${
      dbChoice === "neon" ? "Neon" :
      dbChoice === "docker" ? "Local Postgres (Docker)" :
      pc.dim("skipped — set DATABASE_URL in .env.local")
    }`,
    `${pc.bold("Storage")}    ${storageChoice === "local" ? "Local filesystem" : "Cloudflare R2"}`,
    `${pc.bold("Models")}     ${
      selectedKeys.length > 0
        ? `${selectedKeys.length} provider${selectedKeys.length > 1 ? "s" : ""}`
        : pc.dim("none yet — add keys to .env.local")
    }`,
  ].join("\n");
  p.note(summary, "Configuration");

  const steps = [
    ...(dbChoice === "docker" ? [`docker compose up db -d  ${pc.dim("# start Postgres")}`] : []),
    `pnpm exec drizzle-kit migrate  ${pc.dim("# create tables")}`,
    ...(selectedKeys.length === 0 ? [`${pc.dim("# Add API keys to .env.local")}`] : []),
    `pnpm dev                       ${pc.dim("# start dev server")}`,
  ].join("\n");
  p.note(steps, "Next steps");

  p.outro(`${pc.magenta(pc.bold("✦"))} ${pc.bold("Your studio is configured.")} ${pc.dim("Conjure stunning media with a wave of your wand.")}`);
}

main().catch((err) => {
  p.cancel(err?.message ?? String(err));
  process.exit(1);
});
