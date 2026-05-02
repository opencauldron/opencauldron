/**
 * Unit tests for the per-IP public-gallery rate limiter (T019).
 *
 * Pure function — no DB, no network. Covers cap enforcement, burst window,
 * `retryAfter` math, key isolation, the test-only reset hatch, and the
 * caller-supplied `options` override that the download endpoint uses.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetForTests,
  checkAndConsumeIpRateLimit,
} from "@/lib/public/rate-limit";

describe("checkAndConsumeIpRateLimit — defaults (page route 60/min, 10/5s)", () => {
  beforeEach(() => {
    __resetForTests();
  });
  afterEach(() => {
    __resetForTests();
  });

  it("allows the first 10 burst hits and blocks the 11th within 5s", () => {
    const ip = "1.2.3.4";
    for (let i = 0; i < 10; i++) {
      const r = checkAndConsumeIpRateLimit(ip);
      expect(r.ok).toBe(true);
      expect(r.retryAfterMs).toBe(0);
    }
    const eleventh = checkAndConsumeIpRateLimit(ip);
    expect(eleventh.ok).toBe(false);
    expect(eleventh.retryAfterMs).toBeGreaterThan(0);
    expect(eleventh.retryAfterMs).toBeLessThanOrEqual(5_000);
  });

  it("enforces the 60/min cap when the burst is loosened", () => {
    const ip = "5.6.7.8";
    // Loosen the burst so we can exercise the minute ceiling within a
    // single synchronous test run.
    for (let i = 0; i < 60; i++) {
      const r = checkAndConsumeIpRateLimit(ip, { burstPer5s: 1_000 });
      expect(r.ok).toBe(true);
    }
    const sixtyFirst = checkAndConsumeIpRateLimit(ip, { burstPer5s: 1_000 });
    expect(sixtyFirst.ok).toBe(false);
    expect(sixtyFirst.retryAfterMs).toBeGreaterThan(0);
    expect(sixtyFirst.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("returns retryAfter as a positive integer-able ms value when blocked", () => {
    const ip = "9.9.9.9";
    for (let i = 0; i < 10; i++) {
      checkAndConsumeIpRateLimit(ip);
    }
    const blocked = checkAndConsumeIpRateLimit(ip);
    expect(blocked.ok).toBe(false);
    // Math the consumer will do: Math.ceil(ms / 1000) for Retry-After header.
    const seconds = Math.ceil(blocked.retryAfterMs / 1_000);
    expect(Number.isInteger(seconds)).toBe(true);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(5);
  });
});

describe("checkAndConsumeIpRateLimit — key isolation", () => {
  beforeEach(() => {
    __resetForTests();
  });

  it("keeps each IP's bucket independent", () => {
    const ipA = "10.0.0.1";
    const ipB = "10.0.0.2";

    // Saturate ipA's burst.
    for (let i = 0; i < 10; i++) {
      const r = checkAndConsumeIpRateLimit(ipA);
      expect(r.ok).toBe(true);
    }
    const aBlocked = checkAndConsumeIpRateLimit(ipA);
    expect(aBlocked.ok).toBe(false);

    // ipB still has a full bucket.
    const bFresh = checkAndConsumeIpRateLimit(ipB);
    expect(bFresh.ok).toBe(true);
    expect(bFresh.retryAfterMs).toBe(0);
  });

  it("treats the 'unknown' fallback as its own shared bucket", () => {
    // All requests with no x-forwarded-for header share one key — not a bug,
    // by design (conservative). Verify they actually share.
    for (let i = 0; i < 10; i++) {
      const r = checkAndConsumeIpRateLimit("unknown");
      expect(r.ok).toBe(true);
    }
    const blocked = checkAndConsumeIpRateLimit("unknown");
    expect(blocked.ok).toBe(false);
  });
});

describe("checkAndConsumeIpRateLimit — __resetForTests", () => {
  it("clears state between cases so prior saturation does not leak", () => {
    const ip = "7.7.7.7";
    for (let i = 0; i < 10; i++) {
      checkAndConsumeIpRateLimit(ip);
    }
    expect(checkAndConsumeIpRateLimit(ip).ok).toBe(false);

    __resetForTests();

    expect(checkAndConsumeIpRateLimit(ip).ok).toBe(true);
  });
});

describe("checkAndConsumeIpRateLimit — download config (30/min, 5/5s)", () => {
  beforeEach(() => {
    __resetForTests();
  });

  it("allows the first 5 burst hits and blocks the 6th", () => {
    const ip = "2.2.2.2";
    const opts = { maxPerMinute: 30, burstPer5s: 5 };
    for (let i = 0; i < 5; i++) {
      const r = checkAndConsumeIpRateLimit(ip, opts);
      expect(r.ok).toBe(true);
    }
    const sixth = checkAndConsumeIpRateLimit(ip, opts);
    expect(sixth.ok).toBe(false);
    expect(sixth.retryAfterMs).toBeGreaterThan(0);
    expect(sixth.retryAfterMs).toBeLessThanOrEqual(5_000);
  });

  it("enforces the 30/min cap when the burst is loosened", () => {
    const ip = "3.3.3.3";
    const opts = { maxPerMinute: 30, burstPer5s: 1_000 };
    for (let i = 0; i < 30; i++) {
      const r = checkAndConsumeIpRateLimit(ip, opts);
      expect(r.ok).toBe(true);
    }
    const thirtyFirst = checkAndConsumeIpRateLimit(ip, opts);
    expect(thirtyFirst.ok).toBe(false);
    expect(thirtyFirst.retryAfterMs).toBeGreaterThan(0);
    expect(thirtyFirst.retryAfterMs).toBeLessThanOrEqual(60_000);
  });
});
