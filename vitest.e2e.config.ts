import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts", "./tests/e2e/guard.ts"],
    include: ["tests/e2e/**/*.test.ts", "tests/e2e/**/*.spec.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    watch: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
