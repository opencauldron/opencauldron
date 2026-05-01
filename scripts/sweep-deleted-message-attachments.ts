/**
 * sweep-deleted-message-attachments.ts — Phase 6 / T053.
 *
 * Walks `messages` rows whose `deleted_at` is older than 30 days, removes
 * any R2 blobs they own (`message_attachments` rows where `kind = 'upload'`
 * — `asset_ref` and `external_link` don't own R2 bytes), then hard-deletes
 * the message rows. `message_attachments` rows cascade via the foreign key
 * declared in migration 0018 (`ON DELETE CASCADE`).
 *
 * Idempotent: a re-run finds no eligible rows, deletes nothing, exits 0.
 * `--dry-run` lists what would be deleted without touching anything.
 *
 * Usage:
 *   pnpm tsx scripts/sweep-deleted-message-attachments.ts
 *   pnpm tsx scripts/sweep-deleted-message-attachments.ts --dry-run
 *
 * Output: JSON to stdout —
 *   { deletedMessages: number, deletedR2Keys: number, errors: number,
 *     errorDetails: [...], dryRun: boolean, retentionDays: number }
 *
 * Operational notes:
 *   - Tracks per-key R2 deletion errors but does NOT abort the sweep —
 *     R2 occasionally returns transient `SlowDown` / `InternalError`. The
 *     row stays soft-deleted; the next run picks it up.
 *   - DOES delete the message row even if some R2 keys failed. The orphan
 *     blob is wasted bytes, but the soft-deleted row was the user-visible
 *     concern. We rely on R2's lifecycle / a future janitor to reclaim
 *     orphans.
 */

import { Pool } from "pg";
import dotenv from "dotenv";
import {
  S3Client,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

dotenv.config({ path: ".env.local" });

const RETENTION_DAYS = 30;
const BATCH_SIZE = 100; // Cap per-tick work so a backlog doesn't run forever.

interface SweepReport {
  deletedMessages: number;
  deletedR2Keys: number;
  errors: number;
  errorDetails: Array<{ stage: string; key?: string; messageId?: string; message: string }>;
  dryRun: boolean;
  retentionDays: number;
}

function makeR2Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

async function deleteR2Object(
  client: S3Client,
  bucket: string,
  key: string
): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

async function run(dryRun: boolean): Promise<SweepReport> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) {
    throw new Error("R2_BUCKET_NAME is required");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const r2 = makeR2Client();

  const report: SweepReport = {
    deletedMessages: 0,
    deletedR2Keys: 0,
    errors: 0,
    errorDetails: [],
    dryRun,
    retentionDays: RETENTION_DAYS,
  };

  try {
    // Find eligible messages — soft-deleted older than the retention window.
    // Join attachments so we can pick up R2 keys in the same scan; LEFT JOIN
    // because most messages have zero attachments.
    const { rows } = await pool.query<{
      message_id: string;
      attachment_id: string | null;
      kind: string | null;
      r2_key: string | null;
    }>(
      `
      SELECT
        m.id            AS message_id,
        ma.id           AS attachment_id,
        ma.kind         AS kind,
        ma.r2_key       AS r2_key
      FROM messages m
      LEFT JOIN message_attachments ma ON ma.message_id = m.id
      WHERE m.deleted_at IS NOT NULL
        AND m.deleted_at < NOW() - INTERVAL '${RETENTION_DAYS} days'
      ORDER BY m.deleted_at ASC
      LIMIT ${BATCH_SIZE}
      `
    );

    // Group by messageId.
    const byMessage = new Map<string, string[]>();
    for (const row of rows) {
      if (!byMessage.has(row.message_id)) byMessage.set(row.message_id, []);
      if (row.kind === "upload" && row.r2_key) {
        byMessage.get(row.message_id)!.push(row.r2_key);
      }
    }

    if (byMessage.size === 0) {
      return report;
    }

    // First: delete R2 blobs. Per-key error captured but does NOT abort.
    for (const [messageId, keys] of byMessage) {
      for (const key of keys) {
        if (dryRun) {
          report.deletedR2Keys += 1;
          continue;
        }
        try {
          await deleteR2Object(r2, bucket, key);
          report.deletedR2Keys += 1;
        } catch (err) {
          report.errors += 1;
          report.errorDetails.push({
            stage: "r2_delete",
            key,
            messageId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    if (dryRun) {
      report.deletedMessages = byMessage.size;
      return report;
    }

    // Then: hard-delete the message rows. Attachments cascade.
    const messageIds = Array.from(byMessage.keys());
    const deleteResult = await pool.query<{ id: string }>(
      `DELETE FROM messages WHERE id = ANY($1::uuid[]) RETURNING id`,
      [messageIds]
    );
    report.deletedMessages = deleteResult.rowCount ?? 0;
  } catch (err) {
    report.errors += 1;
    report.errorDetails.push({
      stage: "sweep",
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await pool.end();
  }

  return report;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const report = await run(dryRun);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.errors > 0 ? 1 : 0);
}

if (require.main === module) {
  // Top-level await isn't enabled here; use the classic node entrypoint.
  main().catch((err) => {
    console.error(JSON.stringify({ fatal: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  });
}

export { run as sweepDeletedMessageAttachments };
