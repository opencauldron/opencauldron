/**
 * bootstrap-self-hosted.ts — one-shot installer for self-hosted OpenCauldron
 * (T058). Prompts for a workspace name + admin email, creates the workspace,
 * adds the admin as `owner`, and eagerly creates their Personal brand
 * (FR-006). Idempotent — re-running with the same admin email is a no-op.
 *
 * Usage:
 *   pnpm run bootstrap
 *   docker compose exec app pnpm run bootstrap
 *
 * Non-interactive (CI-friendly):
 *   WORKSPACE_NAME="Acme" ADMIN_EMAIL=admin@acme.com pnpm run bootstrap
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { eq } from "drizzle-orm";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { db } from "../src/lib/db";
import { users, workspaces } from "../src/lib/db/schema";
import { bootstrapSelfHosted } from "../src/lib/workspace/bootstrap";

async function ask(question: string, defaultValue?: string): Promise<string> {
  if (process.env.NON_INTERACTIVE) return defaultValue ?? "";
  const rl = createInterface({ input, output });
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  rl.close();
  return answer || defaultValue || "";
}

async function main() {
  const existing = await db.select().from(workspaces).limit(1);
  if (existing[0]) {
    console.log(`Studio already exists: ${existing[0].name} (slug: ${existing[0].slug}).`);
    console.log("Self-hosted bootstrap is a one-time operation. Exiting.");
    return;
  }

  const workspaceName =
    process.env.WORKSPACE_NAME ?? (await ask("Studio name", "My Studio"));
  const adminEmail =
    process.env.ADMIN_EMAIL ?? (await ask("Admin email"));
  if (!adminEmail) {
    console.error("Admin email is required.");
    process.exit(2);
  }

  // Find or create the admin user.
  let adminId: string | undefined;
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, adminEmail))
    .limit(1);
  if (existingUser) {
    adminId = existingUser.id;
  } else {
    const [created] = await db
      .insert(users)
      .values({ email: adminEmail, role: "admin" })
      .returning({ id: users.id });
    adminId = created.id;
  }

  const result = await bootstrapSelfHosted({
    userId: adminId,
    workspaceName,
  });

  console.log(
    `\n✓ Bootstrap complete.\n  Studio: ${workspaceName} (${result.workspaceSlug})\n  Admin: ${adminEmail}\n  Personal brand: ${result.personalBrandId}\n`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
