-- Migration 0025 — User onboarding columns.
--
-- Adds three nullable timestamp columns to `users` so the public-signup
-- flow can capture display name + workspace name + ToS/Privacy acceptance
-- on first login. Null = user has not yet completed onboarding (the proxy
-- redirects them to /onboarding when WORKSPACE_MODE=hosted; self-host
-- installs leave these null forever and skip the gate).
--
-- Hand-written to match the convention used since 0013 (drizzle-kit
-- generate is blocked on pre-existing snapshot collisions; see 0023's
-- header note). Idempotent — every column add uses `IF NOT EXISTS`.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboarding_completed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "accepted_terms_at" timestamp;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "accepted_privacy_at" timestamp;
