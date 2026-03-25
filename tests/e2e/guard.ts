import { beforeAll } from "vitest";

/**
 * Skip the entire E2E suite unless E2E_ENABLED=true.
 *
 * These tests call real provider APIs, upload to R2, and write to the
 * database. Each full run costs ~$0.59 and takes 3-4 minutes.
 *
 * Usage:  E2E_ENABLED=true npm run test:e2e
 */
beforeAll(() => {
  if (process.env.E2E_ENABLED !== "true") {
    console.log(
      "\n  Skipping E2E provider tests (set E2E_ENABLED=true to run)\n"
    );
    process.exit(0);
  }
});
