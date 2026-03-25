import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1),

  // Auth
  NEXTAUTH_URL: z.string().url().optional(),
  NEXTAUTH_SECRET: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  // Storage
  STORAGE_PROVIDER: z.enum(["local", "r2"]).default("local"),

  // Cloudflare R2 (required when STORAGE_PROVIDER=r2)
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_URL: z.string().url().optional(),

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
