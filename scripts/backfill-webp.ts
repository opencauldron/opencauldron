/**
 * backfill-webp.ts — Phase 5 (T013/T014/T015) backfill for the WebP display
 * variant (specs/webp-image-delivery).
 *
 * For every existing image asset that has no WebP variant yet, fetch the
 * original from R2, encode a `_display.webp` via the same `encodeDisplayWebp`
 * helper used by the upload + generate routes, PUT to R2, and update the
 * row to set webp_r2_key / webp_file_size / webp_status / original_mime_type.
 *
 * Resumability:
 *   - The driver loop is `WHERE webp_status IS NULL AND mime_type LIKE
 *     'image/%' LIMIT 50` re-queried each iteration. There is NO offset
 *     bookkeeping — once a row's status flips to 'ready' or 'failed' it
 *     drops out of the working set automatically. Crash-safe: re-running
 *     resumes from wherever the database state actually is, no checkpoint
 *     file required.
 *   - Already-ready rows are silently skipped. Already-failed rows are
 *     also skipped (their reason is preserved); to retry failures the
 *     operator can manually `UPDATE assets SET webp_status = NULL WHERE
 *     webp_status = 'failed'` then re-run.
 *
 * Concurrency:
 *   - Inner `Promise.all` per batch with a hard cap of 4 in-flight
 *     encodings. Sharp + R2 PUT runs serially within each worker; four
 *     workers keeps memory well below the M1 Pro / Vercel runner ceiling.
 *
 * Failure semantics:
 *   - Per-row try/catch. A failure persists `webp_status='failed'` with a
 *     reason and continues; the original asset row is never touched.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-webp.ts                      # real run
 *   pnpm tsx scripts/backfill-webp.ts --dry-run            # report only
 *   pnpm tsx scripts/backfill-webp.ts --batch=20 --concurrency=2
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const BATCH_SIZE_DEFAULT = 50;
const CONCURRENCY_DEFAULT = 4;
const LOG_EVERY_DEFAULT = 50;

interface AssetRow {
  id: string;
  r2_key: string;
  mime_type: string | null;
}

interface BackfillCounters {
  scanned: number;
  ready: number;
  failed: number;
  totalBytesIn: number;
  totalBytesOut: number;
  losslessCount: number;
}

function parseFlags(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const batchArg = argv.find((a) => a.startsWith("--batch="));
  const concurrencyArg = argv.find((a) => a.startsWith("--concurrency="));
  return {
    dryRun,
    batchSize: batchArg ? parseInt(batchArg.slice("--batch=".length), 10) : BATCH_SIZE_DEFAULT,
    concurrency: concurrencyArg
      ? parseInt(concurrencyArg.slice("--concurrency=".length), 10)
      : CONCURRENCY_DEFAULT,
  };
}

async function main() {
  const { dryRun, batchSize, concurrency } = parseFlags(process.argv.slice(2));

  // Dynamic imports so dotenv has loaded BEFORE the storage module's
  // module-load-time R2 client construction (which reads `process.env.R2_*`).
  const { Pool } = await import("pg");
  const { encodeDisplayWebp, displayWebpKey, uploadFile, getAssetUrl } = await import(
    "@/lib/storage"
  );

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // First, take a census so the operator knows the rough scale + estimate.
  const census = await pool.query<{ count: string; total_bytes: string }>(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(COALESCE(file_size, 0)), 0)::text AS total_bytes
       FROM assets
      WHERE webp_status IS NULL
        AND media_type = 'image'`
  );
  const todoCount = parseInt(census.rows[0]?.count ?? "0", 10);
  const todoBytes = parseInt(census.rows[0]?.total_bytes ?? "0", 10);
  console.log(
    `[census] ${todoCount} image assets pending WebP encode; ${(
      todoBytes /
      1024 /
      1024
    ).toFixed(1)} MB of originals to read.`
  );

  // R2 cost: Class B operations (GET) for each original read + Class A (PUT)
  // for each WebP write. As of 2026, R2 lists $0.36 per million Class A and
  // $4.50 per million Class B. Egress to compute is free for R2.
  const classA = todoCount; // PUTs
  const classB = todoCount; // GETs
  const estUsd = (classA / 1_000_000) * 0.36 + (classB / 1_000_000) * 4.5;
  console.log(
    `[census] estimated R2 op cost: $${estUsd.toFixed(4)} (${classA} PUTs + ${classB} GETs)`
  );

  if (dryRun) {
    console.log("[dry-run] exiting before any writes.");
    await pool.end();
    return;
  }

  const counters: BackfillCounters = {
    scanned: 0,
    ready: 0,
    failed: 0,
    totalBytesIn: 0,
    totalBytesOut: 0,
    losslessCount: 0,
  };
  const startedAt = Date.now();
  let nextLogAt = LOG_EVERY_DEFAULT;

  // Naturally idempotent loop: re-query "WHERE webp_status IS NULL" each
  // iteration so completed rows drop out automatically.
  // Loop until the query returns 0 rows.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { rows } = await pool.query<AssetRow>(
      `SELECT a.id, a.r2_key, COALESCE(u.content_type, NULL) AS mime_type
         FROM assets a
         LEFT JOIN uploads u ON u.asset_id = a.id
        WHERE a.webp_status IS NULL
          AND a.media_type = 'image'
        ORDER BY a.created_at ASC
        LIMIT $1`,
      [batchSize]
    );
    if (rows.length === 0) break;

    // Process the batch with a concurrency cap.
    const inflight: Promise<void>[] = [];
    for (const row of rows) {
      const task = processOne(row).then(() => {
        counters.scanned++;
        if (counters.scanned >= nextLogAt) {
          const elapsed = (Date.now() - startedAt) / 1000;
          const rate = counters.scanned / elapsed;
          console.log(
            `[progress] ${counters.scanned} processed (${counters.ready} ready / ${counters.failed} failed) — ${rate.toFixed(1)} rows/s`
          );
          nextLogAt += LOG_EVERY_DEFAULT;
        }
      });
      inflight.push(task);
      if (inflight.length >= concurrency) {
        // Wait for one to clear before dispatching the next. Race resolves
        // when the fastest in-flight finishes; we then drop it from the list.
        await Promise.race(inflight.map((p, i) => p.then(() => i)));
        // Garbage-collect settled promises.
        for (let i = inflight.length - 1; i >= 0; i--) {
          // A settled promise resolves immediately on next tick.
          // We can't introspect status from a Promise, so just await all
          // and rebuild the list when full. Simplest correct approach:
          break;
        }
        // Drain fully when at cap, then start fresh — keeps the model simple
        // and the working set bounded. The slight efficiency loss vs a true
        // sliding-window pool is irrelevant at 4-wide.
        await Promise.all(inflight);
        inflight.length = 0;
      }
    }
    // Drain trailing in-flight before re-querying (otherwise we'd re-pick
    // rows whose status hasn't been updated yet).
    await Promise.all(inflight);
  }

  const elapsed = (Date.now() - startedAt) / 1000;
  console.log("\n[summary]");
  console.log(`  processed:  ${counters.scanned}`);
  console.log(`  ready:      ${counters.ready}`);
  console.log(`  failed:     ${counters.failed}`);
  console.log(`  lossless:   ${counters.losslessCount}`);
  console.log(`  bytes in:   ${(counters.totalBytesIn / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  bytes out:  ${(counters.totalBytesOut / 1024 / 1024).toFixed(1)} MB`);
  if (counters.totalBytesIn > 0) {
    const ratio = counters.totalBytesOut / counters.totalBytesIn;
    console.log(`  ratio out/in: ${(ratio * 100).toFixed(1)}%`);
  }
  console.log(`  elapsed:    ${elapsed.toFixed(1)} s`);
  await pool.end();

  async function processOne(row: AssetRow): Promise<void> {
    try {
      const url = await getAssetUrl(row.r2_key);
      const res = await fetch(url);
      if (!res.ok) {
        await markFailed(row.id, `r2_get_${res.status}`);
        return;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      counters.totalBytesIn += buf.length;
      const mime = row.mime_type ?? sniffMime(row.r2_key) ?? "image/png";
      const enc = await encodeDisplayWebp(buf, mime);
      if (!enc.ok) {
        await markFailed(row.id, `encode: ${enc.reason}`, mime);
        return;
      }
      const webpKey = displayWebpKey(row.r2_key);
      try {
        await uploadFile(enc.buffer, webpKey, "image/webp");
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await markFailed(row.id, `r2_put: ${reason}`, mime);
        return;
      }
      counters.totalBytesOut += enc.size;
      if (enc.usedLossless) counters.losslessCount++;
      await pool.query(
        `UPDATE assets
            SET webp_r2_key = $1,
                webp_file_size = $2,
                webp_status = 'ready',
                webp_failed_reason = NULL,
                original_mime_type = COALESCE(original_mime_type, $3)
          WHERE id = $4`,
        [webpKey, enc.size, mime, row.id]
      );
      counters.ready++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await markFailed(row.id, `unexpected: ${reason}`);
    }
  }

  async function markFailed(id: string, reason: string, mime?: string) {
    await pool.query(
      `UPDATE assets
          SET webp_status = 'failed',
              webp_failed_reason = $1,
              original_mime_type = COALESCE(original_mime_type, $2)
        WHERE id = $3`,
      [reason, mime ?? null, id]
    );
    counters.failed++;
    console.error(`[failed] ${id}: ${reason}`);
  }
}

function sniffMime(key: string): string | null {
  const ext = key.toLowerCase().split(".").pop();
  if (!ext) return null;
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return null;
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
