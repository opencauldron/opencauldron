import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1),

  // Workspace mode — hosted = SaaS multi-tenant; self_hosted = single-tenant Docker install.
  // Drives bootstrap path, workspace switcher visibility (hidden in self_hosted), and feature flags.
  WORKSPACE_MODE: z.enum(["hosted", "self_hosted"]).default("hosted"),

  // Phase 2 collections / share-link surface — keep hidden in MVP.
  FEATURE_SHARED_WITH_YOU: z
    .union([z.literal("true"), z.literal("false")])
    .default("false")
    .transform((v) => v === "true"),

  // Library/DAM unification — when off, /library and /api/library 404 and the
  // sidebar still points at /references. Flip to "true" once the unified
  // Library is ready to ship.
  LIBRARY_DAM_ENABLED: z
    .union([z.literal("true"), z.literal("false")])
    .default("false")
    .transform((v) => v === "true"),

  // Dev-only login shortcut for automated browser QA. Honored ONLY when
  // BOTH `NODE_ENV !== "production"` AND `DEV_LOGIN_ENABLED === "true"` —
  // see `src/app/api/dev-login/route.ts` for the exact gate. The flag is
  // `false` by default and a build-time check in `next.config.ts` aborts
  // production builds where it's set to true. NEVER enable in prod.
  DEV_LOGIN_ENABLED: z
    .union([z.literal("true"), z.literal("false")])
    .default("false")
    .transform((v) => v === "true"),

  // SSE liveness — heartbeat keeps proxies from killing the connection;
  // proactive reconnect lands inside Vercel's 5-minute serverless timeout.
  SSE_HEARTBEAT_MS: z.coerce.number().int().positive().default(25_000),
  SSE_RECONNECT_MS: z.coerce.number().int().positive().default(270_000),

  // Per-(user, thread) write rate limits. Buckets live in-process; the cap is
  // per Node instance, so a user opening many tabs can exceed slightly when a
  // load balancer fans them across instances — that's an accepted v1 limit.
  THREAD_RATE_LIMIT_MAX_PER_MIN: z.coerce.number().int().positive().default(20),
  THREAD_RATE_LIMIT_BURST_PER_5S: z.coerce.number().int().positive().default(5),
  /**
   * Reactions get a separate, slightly more permissive ceiling per NFR-004
   * (30/min vs the 20/min message cap). Same per-(user, thread) bucket
   * structure, just a different ceiling passed at check time.
   */
  THREAD_REACTION_RATE_LIMIT_MAX_PER_MIN: z.coerce
    .number()
    .int()
    .positive()
    .default(30),

  /**
   * Per-user trailing-24h thread upload soft-cap (T054). Uploaded bytes
   * across the user's `message_attachments` in the last 24h must stay under
   * this. 1 GiB default. Going over returns 413 + a `Retry-After` hint.
   * `asset_ref` and `external_link` attachments do NOT count — they don't
   * own R2 bytes.
   */
  THREAD_USER_DAILY_STORAGE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(1_073_741_824),

  // Auth
  NEXTAUTH_URL: z.string().url().optional(),
  NEXTAUTH_SECRET: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  // Resend email magic-link (optional — provider is only registered when
  // both vars are set, so self-host installs without Resend keep working).
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v))
    .pipe(z.string().email().optional()),

  // Storage
  STORAGE_PROVIDER: z.enum(["local", "r2"]).default("local"),

  // Cloudflare R2 (required when STORAGE_PROVIDER=r2)
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_URL: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v))
    .pipe(z.string().url().optional()),

  // Image Generation APIs (optional - models disabled if missing)
  GEMINI_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  BFL_API_KEY: z.string().optional(),
  IDEOGRAM_API_KEY: z.string().optional(),
  RECRAFT_API_KEY: z.string().optional(),

  // Video Generation APIs (optional - models disabled if missing)
  RUNWAY_API_KEY: z.string().optional(),
  FAL_KEY: z.string().optional(),
  MINIMAX_API_KEY: z.string().optional(),
  LUMA_API_KEY: z.string().optional(),

  // Prompt Improver
  MISTRAL_API_KEY: z.string().optional(),

  // Library/DAM — embedding pipeline (Replicate clip-features, ViT-L/14, 768-dim)
  REPLICATE_API_TOKEN: z.string().optional(),
  EMBEDDING_MODEL: z.string().default("andreasjansson/clip-features"),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(768),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  EMBEDDING_CRON_INTERVAL_MIN: z.coerce.number().int().positive().default(2),
});

export type Env = z.infer<typeof envSchema>;

function getEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }

  // Validate R2 credentials when R2 storage is selected
  if (parsed.data.STORAGE_PROVIDER === "r2") {
    const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"] as const;
    const missing = required.filter((k) => !parsed.data[k]);
    if (missing.length > 0) {
      throw new Error(`R2 storage requires: ${missing.join(", ")}`);
    }
  }

  return parsed.data;
}

export const env = getEnv();
