/**
 * Unit tests for the structured telemetry helper (Phase 6 / T055).
 *
 * Single-line JSON-on-stdout pattern; verifies the schema (`event`,
 * `threadId`, `userId`, `workspaceId`, `latencyMs`, `outcome`) and the
 * SQL-state extraction from arbitrary error shapes.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractSqlState,
  logThreadEvent,
  startThreadTimer,
} from "@/lib/threads/telemetry";

describe("logThreadEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits a single JSON line for ok outcomes via console.log", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logThreadEvent({
      event: "message.create",
      threadId: "t-1",
      userId: "u-1",
      workspaceId: "w-1",
      latencyMs: 42,
      outcome: "ok",
      details: { messageId: "m-1" },
    });
    expect(log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(log.mock.calls[0][0] as string);
    expect(payload).toMatchObject({
      ns: "[threads]",
      event: "message.create",
      threadId: "t-1",
      userId: "u-1",
      workspaceId: "w-1",
      latencyMs: 42,
      outcome: "ok",
      details: { messageId: "m-1" },
    });
    expect(typeof payload.ts).toBe("string");
  });

  it("uses console.error for outcome=error", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    logThreadEvent({
      event: "message.create",
      threadId: "t-1",
      userId: null,
      workspaceId: null,
      latencyMs: 100,
      outcome: "error",
      error: { code: "23505", message: "duplicate key" },
    });
    expect(log).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(1);
  });
});

describe("extractSqlState", () => {
  it("extracts pg-style error shape", () => {
    class PgError extends Error {
      code = "23505";
      severity = "ERROR";
    }
    const sqlState = extractSqlState(new PgError("duplicate key"));
    expect(sqlState).toMatchObject({
      code: "23505",
      severity: "ERROR",
      message: "duplicate key",
    });
  });

  it("falls back to string form for non-objects", () => {
    expect(extractSqlState("a string error")).toMatchObject({
      message: "a string error",
    });
  });

  it("clamps message to 500 chars", () => {
    const long = "x".repeat(2000);
    const out = extractSqlState(new Error(long));
    expect(out?.message?.length).toBe(500);
  });
});

describe("startThreadTimer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits latency in ms after finish", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const finish = startThreadTimer({
      event: "reaction.toggle",
      threadId: "t",
      userId: "u",
      workspaceId: "w",
    });
    await new Promise((r) => setTimeout(r, 5));
    finish("ok", { details: { delta: "+1" } });
    const payload = JSON.parse(log.mock.calls[0][0] as string);
    expect(payload.latencyMs).toBeGreaterThanOrEqual(0);
    expect(payload.outcome).toBe("ok");
    expect(payload.details).toMatchObject({ delta: "+1" });
  });
});
