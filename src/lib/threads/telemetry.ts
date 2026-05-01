/**
 * Structured telemetry for the threads surface (T055 / NFR-009).
 *
 * Goal: every message post / edit / delete / reaction toggle / SSE
 * connect-disconnect emits a single-line JSON log so an operator can
 * follow per-thread activity in the platform's log aggregator without
 * extra wiring.
 *
 * Why a thin wrapper around `console.log`: the project does not use a
 * structured logger today (`grep "console\." src/lib/` shows raw prefixed
 * `console.warn`/`console.error` everywhere), and introducing a vendor
 * dep just for threads would be over-engineering. JSON-on-stdout is the
 * canonical Vercel + Next.js pattern — `vercel logs --output json` parses
 * each line straight into structured fields.
 *
 * Event shape is intentionally narrow: `event` is the kind, `outcome` is
 * one of `ok | error | rejected | rate_limited`, plus the NFR-009 fields
 * `threadId`, `userId`, `workspaceId`, and `latencyMs`. `error` carries
 * the SQL state when present (`err.code`, `err.severity`).
 */

export type ThreadTelemetryOutcome =
  | "ok"
  | "error"
  | "rejected"
  | "rate_limited";

export type ThreadTelemetryEvent =
  | "message.create"
  | "message.update"
  | "message.delete"
  | "reaction.toggle"
  | "sse.connect"
  | "sse.disconnect";

export interface ThreadTelemetryFields {
  event: ThreadTelemetryEvent;
  threadId: string | null;
  userId: string | null;
  workspaceId: string | null;
  latencyMs: number | null;
  outcome: ThreadTelemetryOutcome;
  /** Free-form details — kept small (<1KB stringified) so logs stay greppable. */
  details?: Record<string, unknown>;
  /** Captured for `outcome === "error"` paths. */
  error?: {
    name?: string;
    message?: string;
    /** Postgres SQLSTATE if available (`pg`/`postgres`/`@neondatabase` errors). */
    code?: string;
    severity?: string;
  };
}

const NS = "[threads]";

/**
 * Emit a single structured log line. `console.log` for `ok` / `rejected` /
 * `rate_limited`; `console.error` for `error` so the logger picks up the
 * right severity.
 */
export function logThreadEvent(fields: ThreadTelemetryFields): void {
  const payload = {
    ts: new Date().toISOString(),
    ns: NS,
    ...fields,
  };
  if (fields.outcome === "error") {
    console.error(JSON.stringify(payload));
  } else {
    console.log(JSON.stringify(payload));
  }
}

/**
 * Extract a Postgres error code + severity from any `unknown` thrown value.
 * `pg`, `@neondatabase/serverless`, and `postgres` all expose `.code` /
 * `.severity` on their error subclasses.
 */
export function extractSqlState(err: unknown): ThreadTelemetryFields["error"] {
  if (err && typeof err === "object") {
    const e = err as {
      name?: string;
      message?: string;
      code?: string;
      severity?: string;
    };
    return {
      name: e.name,
      message: typeof e.message === "string" ? e.message.slice(0, 500) : undefined,
      code: typeof e.code === "string" ? e.code : undefined,
      severity: typeof e.severity === "string" ? e.severity : undefined,
    };
  }
  return { message: String(err).slice(0, 500) };
}

/**
 * Convenience wrapper — start a timer, return a `finish(outcome, extras)`
 * function that emits the log line with the elapsed `latencyMs`.
 */
export function startThreadTimer(
  base: Omit<ThreadTelemetryFields, "outcome" | "latencyMs" | "error">
): (
  outcome: ThreadTelemetryOutcome,
  extras?: Partial<Pick<ThreadTelemetryFields, "details" | "error">>
) => void {
  const startedAt = performance.now();
  return (outcome, extras) => {
    logThreadEvent({
      ...base,
      outcome,
      latencyMs: Math.round(performance.now() - startedAt),
      details: extras?.details,
      error: extras?.error,
    });
  };
}
