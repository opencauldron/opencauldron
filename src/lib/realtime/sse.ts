/**
 * SSE response helpers (T007).
 *
 * Usage:
 *
 *   const { response, push, close } = createSseStream({ onClose: () => sub.unsubscribe() });
 *   sub = subscribeToThread(id, (ev) => push({ event: ev.kind, id: ev.eventId, data: ev }));
 *   return response;
 *
 * Format conformance points (per the kickoff spec):
 *   - `Content-Type: text/event-stream`
 *   - `Cache-Control: no-cache, no-transform`
 *   - `X-Accel-Buffering: no`        (nginx-compatible proxies must not buffer)
 *   - `Content-Encoding: identity`   (NEVER gzip — proxies pile events otherwise)
 *   - heartbeat `:ping\n\n` every SSE_HEARTBEAT_MS
 *   - proactive `event: reconnect` near 4:30 so the client refreshes well
 *     inside Vercel's 5-minute serverless timeout
 *
 * Keep this module server-only — `ReadableStream` works in the Node runtime
 * but the proper way to opt-in is `export const runtime = 'nodejs'` on the
 * route file (T022 does this).
 */

import "server-only";
import { env } from "@/lib/env";

export interface SseEvent {
  /** Optional event name; default `message`. Sent as `event: <name>`. */
  event?: string;
  /** Optional id. Sent as `id: <id>` so reconnecting clients can pass `Last-Event-Id`. */
  id?: string;
  /** Payload — strings are sent as-is, objects are JSON-stringified. */
  data: unknown;
  /** Optional `retry: <ms>` directive. Browsers honour it for the next reconnect. */
  retry?: number;
}

export interface CreateSseStreamOptions {
  onClose?: () => void;
  /** Override heartbeat for tests. Defaults to env.SSE_HEARTBEAT_MS. */
  heartbeatMs?: number;
  /** Override proactive reconnect timer for tests. Defaults to env.SSE_RECONNECT_MS. */
  reconnectMs?: number;
}

export interface SseHandle {
  response: Response;
  push: (event: SseEvent) => void;
  close: () => void;
}

/**
 * Format a single SSE message frame. Multi-line `data:` is split per spec.
 */
export function formatEvent(ev: SseEvent): string {
  const lines: string[] = [];
  if (ev.id !== undefined) lines.push(`id: ${ev.id}`);
  if (ev.event !== undefined) lines.push(`event: ${ev.event}`);
  if (ev.retry !== undefined) lines.push(`retry: ${ev.retry}`);
  const data =
    typeof ev.data === "string" ? ev.data : JSON.stringify(ev.data);
  // SSE spec — every newline in the payload becomes a separate `data:` field.
  for (const line of data.split("\n")) {
    lines.push(`data: ${line}`);
  }
  // Frame terminator: blank line.
  lines.push("");
  lines.push("");
  return lines.join("\n");
}

/**
 * Build a streaming SSE Response with a heartbeat and proactive reconnect
 * directive. Returns `push` for the caller to forward events into the stream
 * and `close` for explicit teardown (the route's `request.signal.aborted`
 * also tears the stream down).
 */
export function createSseStream(
  options: CreateSseStreamOptions = {}
): SseHandle {
  const heartbeatMs = options.heartbeatMs ?? env.SSE_HEARTBEAT_MS;
  const reconnectMs = options.reconnectMs ?? env.SSE_RECONNECT_MS;

  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const teardown = () => {
    if (closed) return;
    closed = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try {
      controller?.close();
    } catch {
      // already closed by client disconnect
    }
    options.onClose?.();
  };

  const enqueue = (chunk: string) => {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      teardown();
    }
  };

  const push = (event: SseEvent) => {
    enqueue(formatEvent(event));
  };

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      // Initial preamble: an SSE comment + the browser's reconnect hint.
      enqueue(`: connected\n\n`);
      enqueue(`retry: 3000\n\n`);

      heartbeatTimer = setInterval(() => {
        enqueue(`:ping\n\n`);
      }, heartbeatMs);

      // Proactive reconnect well before Vercel's 5-min serverless timeout.
      reconnectTimer = setTimeout(() => {
        push({
          event: "reconnect",
          data: { reason: "proactive" },
        });
        // Give the client a tick to receive then close cleanly.
        setTimeout(teardown, 100);
      }, reconnectMs);
    },
    cancel() {
      teardown();
    },
  });

  const response = new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "Content-Encoding": "identity",
    },
  });

  return { response, push, close: teardown };
}
