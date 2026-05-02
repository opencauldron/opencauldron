/**
 * Activity feed event emitter.
 *
 * Single canonical INSERT into `activity_events`. One call per lifecycle
 * moment. Append-only: this module never updates or deletes rows. The only
 * other writer is `scripts/backfill-activity.ts` (one-shot historical seed,
 * also INSERT-only via ON CONFLICT). See the comment block on the
 * `activityEvents` table in `src/lib/db/schema.ts` for the full invariant.
 *
 * Boundary: pure DB helper. Callers pass the actor / workspace / brand IDs
 * they already have; this module does no auth or membership lookups.
 *
 * Visibility is computed by the CALLER and passed in (FR-002). The helper
 * does NOT derive it. Each emission site knows its own context (e.g. "is
 * this asset on a personal brand?") cheaper and more correctly than a
 * generic helper could re-compute it from the row alone. See plan.md key
 * decision: "Visibility computed at WRITE time, stored as a column".
 *
 * Transactional contract: pass the parent transaction's `tx` handle so the
 * activity row is part of the same atomic write as the underlying state
 * change. If the parent transaction rolls back, no event is written. The
 * helper duck-types the executor on `.insert()` so it accepts both the
 * global `db` handle (drizzle-orm/neon-http, no transaction support) for
 * single-row writes that don't need atomicity, AND the WebSocket-backed
 * `ThreadTxScope` from `src/lib/db/tx.ts` for in-tx emissions.
 */

import { activityEvents } from "@/lib/db/schema";
import type {
  ACTIVITY_VERBS,
  ACTIVITY_VISIBILITIES,
} from "@/lib/db/schema";

export type ActivityVerb = (typeof ACTIVITY_VERBS)[number];
export type ActivityVisibility = (typeof ACTIVITY_VISIBILITIES)[number];

export interface EmitActivityInput {
  actorId: string;
  verb: ActivityVerb;
  objectType: string;
  objectId: string;
  workspaceId: string;
  /** Workspace-scoped events (level-up, feat earned) pass `null` or omit. */
  brandId?: string | null;
  /** Pre-computed by the caller. The helper does NOT derive visibility. */
  visibility: ActivityVisibility;
  metadata?: Record<string, unknown>;
  /** Set ONLY by `scripts/backfill-activity.ts`. Live emissions leave undefined. */
  backfillKey?: string;
}

/**
 * Minimal duck-typed executor — what we need from `db` or a `tx` handle.
 * Both `drizzle-orm/neon-http`'s db and `drizzle-orm/neon-serverless`'s tx
 * scope expose this surface, but their concrete types live in different
 * generic instantiations and don't unify cleanly. This interface lets the
 * caller pass either without a cast at the call site.
 */
export interface ActivityEmitExecutor {
  insert: (table: typeof activityEvents) => {
    values: (row: typeof activityEvents.$inferInsert) => {
      returning: (columns: { id: typeof activityEvents.id }) => Promise<
        Array<{ id: string }>
      >;
    };
  };
}

/**
 * Insert exactly one row into `activity_events`. Returns the new row's id.
 *
 * @param exec - the parent transaction's `tx` handle (preferred — atomic with
 *   the underlying state change), or the global `db` handle for standalone
 *   emissions that don't need transactional coupling.
 * @param input - the event fields. `visibility` is computed at the call site
 *   (FR-002); the helper never derives it.
 */
export async function emitActivity(
  exec: ActivityEmitExecutor,
  input: EmitActivityInput
): Promise<{ id: string }> {
  const [row] = await exec
    .insert(activityEvents)
    .values({
      actorId: input.actorId,
      verb: input.verb,
      objectType: input.objectType,
      objectId: input.objectId,
      workspaceId: input.workspaceId,
      brandId: input.brandId ?? null,
      visibility: input.visibility,
      metadata: input.metadata ?? {},
      backfillKey: input.backfillKey ?? null,
    })
    .returning({ id: activityEvents.id });
  return { id: row.id };
}
