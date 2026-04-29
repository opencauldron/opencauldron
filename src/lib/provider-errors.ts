/**
 * Sanitize an upstream provider error body before surfacing it to the client.
 *
 * Several of our providers (everything FAL-backed, and OpenAI-style schemas
 * too) respond to 4xx with a JSON envelope that echoes the entire request
 * `input` — including signed S3 URLs for reference images, the full prompt,
 * and every parameter. Piping that verbatim into a toast leaks signed asset
 * URLs into the UI and buries the real failure under a wall of text.
 *
 * `summarizeProviderError` extracts the human-meaningful field
 * (`detail` / `message` / `error`, including the `[{msg, loc}]` shape FastAPI
 * uses) and truncates. Non-JSON bodies are truncated as plain text.
 */
export function summarizeProviderError(raw: string, max = 240): string {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const msg = extractMessage(parsed);
    if (msg) return clip(msg, max);
  } catch {
    // Not JSON — fall through to plain-text truncation.
  }
  return clip(trimmed, max);
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function extractMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.detail === "string") return obj.detail;
  if (Array.isArray(obj.detail) && obj.detail.length > 0) {
    const parts = obj.detail
      .map((d) => {
        if (!d || typeof d !== "object") return null;
        const item = d as Record<string, unknown>;
        const msg = typeof item.msg === "string" ? item.msg : null;
        const loc = Array.isArray(item.loc)
          ? item.loc
              .filter((l) => typeof l === "string" || typeof l === "number")
              .join(".")
          : null;
        if (msg && loc) return `${loc}: ${msg}`;
        return msg;
      })
      .filter((s): s is string => Boolean(s));
    if (parts.length > 0) return parts.join("; ");
  }
  if (typeof obj.message === "string") return obj.message;
  if (typeof obj.error === "string") {
    return obj.error;
  }
  // Some providers nest under { error: { message } } (OpenAI shape).
  if (
    obj.error &&
    typeof obj.error === "object" &&
    typeof (obj.error as Record<string, unknown>).message === "string"
  ) {
    return (obj.error as Record<string, unknown>).message as string;
  }
  return null;
}
