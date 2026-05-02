#!/usr/bin/env node
/**
 * check-activity-append-only.mjs — guard the `activity_events` append-only
 * invariant (spec FR-001 / plan risk row "Append-only assumption violated").
 *
 * Greps the codebase for any `db.update(activityEvents)` /
 * `tx.update(activityEvents)` / `db.delete(activityEvents)` /
 * `tx.delete(activityEvents)` and exits non-zero if any are found outside
 * the two legitimate writers:
 *   - `src/lib/activity.ts`          (canonical emitter — INSERT only)
 *   - `scripts/backfill-activity.mjs` (one-shot backfill — INSERT only)
 *
 * Run via `pnpm run lint:append-only`. Cheap (a few hundred files); intended
 * to be wired into CI alongside `pnpm run lint`.
 *
 * Why .mjs (not .ts): the rest of the repo's scripts use `tsx` to run
 * TypeScript, but `tsx` isn't a project dependency — the existing scripts
 * (verify-migration, bootstrap, etc.) assume it's globally available. Plain
 * .mjs needs nothing beyond Node 20+, so this guard works on a fresh clone
 * without extra setup. Same reason `bootstrap-runtime.mjs` and
 * `migrate-runtime.mjs` use the same extension.
 *
 * Why a separate script (not eslint-plugin): the rule is one regex over the
 * whole repo. An ESLint custom rule would need a plugin scaffold for what's
 * a 30-line check. Easier to read, easier to grep for, easier to extend.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const SCAN_DIRS = ["src", "scripts", "tests"];
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
]);
const SCAN_EXTS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

// Allowed call sites — paths are relative to repo root (forward slashes).
const ALLOW = new Set([
  "src/lib/activity.ts",
  "scripts/backfill-activity.mjs",
  "scripts/check-activity-append-only.mjs", // self-reference (the regex itself)
]);

// One regex catches `.update(activityEvents` and `.delete(activityEvents`
// regardless of whether it's `db.`, `tx.`, `someHandle.`, etc. We deliberately
// look at the call site, not the import, because re-exporting the table is
// fine; only mutation calls are forbidden.
const FORBIDDEN = /\.(?:update|delete)\s*\(\s*activityEvents\b/;

// Skip lines whose first non-whitespace characters are a comment marker
// (`//`, `/*`, `*`). We don't try to parse multi-line comments precisely;
// if a real call to .update(activityEvents) is buried inside a `/* */` block
// it's still flagged, which is the right call (someone disabling code).
const COMMENT_LINE = /^\s*(?:\/\/|\/\*+|\*)/;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIR_NAMES.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(p);
    } else if (e.isFile()) {
      const dot = e.name.lastIndexOf(".");
      const ext = dot >= 0 ? e.name.slice(dot) : "";
      if (SCAN_EXTS.has(ext)) yield p;
    }
  }
}

async function scan() {
  const findings = [];
  for (const sub of SCAN_DIRS) {
    const root = join(ROOT, sub);
    try {
      await stat(root);
    } catch {
      continue;
    }
    for await (const file of walk(root)) {
      const rel = relative(ROOT, file).split("\\").join("/");
      if (ALLOW.has(rel)) continue;
      const text = await readFile(file, "utf8");
      if (!FORBIDDEN.test(text)) continue;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (COMMENT_LINE.test(line)) continue;
        if (FORBIDDEN.test(line)) {
          findings.push({ file: rel, line: i + 1, text: line.trim() });
        }
      }
    }
  }
  return findings;
}

async function main() {
  const findings = await scan();
  if (findings.length === 0) {
    console.log(
      "[lint:append-only] activity_events append-only invariant: OK (no forbidden mutations found)"
    );
    return;
  }
  console.error(
    "\n[lint:append-only] activity_events append-only invariant VIOLATED:\n"
  );
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.text}`);
  }
  console.error(
    "\nRows in `activity_events` are immutable (spec FR-001). The only legitimate"
  );
  console.error(
    "writers are `src/lib/activity.ts` (INSERT) and `scripts/backfill-activity.mjs`"
  );
  console.error(
    "(INSERT with ON CONFLICT). State changes that 'broaden' visibility must emit"
  );
  console.error("a NEW event — never mutate the prior row.\n");
  process.exit(1);
}

main().catch((err) => {
  console.error("[lint:append-only] crashed:", err);
  process.exit(2);
});
