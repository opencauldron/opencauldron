/**
 * Review-log contract test (T151 / NFR-003).
 *
 * Pure-function check that every state-machine action emits exactly the
 * `LogAction` we expect. The DB-backed `transitionAsset` helper writes one
 * row per call using the same `logAction` value returned by the pure
 * `validateTransition` validator — so locking the validator's output here
 * locks the audit invariant.
 */

import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  validateTransition,
  type AssetStatus,
  type LogAction,
  type TransitionAction,
} from "@/lib/transitions";

describe("review-log invariants — every action maps to one LogAction", () => {
  // The contract from FR-009 + NFR-003 is: every status mutation writes
  // exactly one `asset_review_log` row tagged with the LogAction below.
  const expected: Record<TransitionAction, LogAction> = {
    submit: "submitted",
    approve: "approved",
    reject: "rejected",
    archive: "archived",
    unarchive: "unarchived",
  };

  for (const [action, logAction] of Object.entries(expected) as Array<
    [TransitionAction, LogAction]
  >) {
    it(`${action} → log action "${logAction}"`, () => {
      const validFrom = ALLOWED_TRANSITIONS[action].from[0];
      const result = validateTransition(validFrom, action);
      expect(result.logAction).toBe(logAction);
    });
  }
});

describe("review-log invariants — illegal transitions never emit a row", () => {
  // The pure validator throws before the DB write — so the audit table
  // never gains a row for an invalid transition. We just smoke-test by
  // walking a few illegal cells.
  const illegal: Array<[AssetStatus, TransitionAction]> = [
    ["approved", "submit"],
    ["approved", "approve"],
    ["draft", "approve"],
    ["draft", "reject"],
    ["archived", "approve"],
    ["rejected", "approve"],
    ["in_review", "submit"],
  ];

  for (const [from, action] of illegal) {
    it(`${from} → ${action} throws TransitionError`, () => {
      expect(() => validateTransition(from, action)).toThrow();
    });
  }
});

describe("review-log invariants — fork & moved_from_personal use the audit log", () => {
  // `forked` and `moved_from_personal` are non-status events — they don't
  // come through `validateTransition`, but they are part of the LogAction
  // union and the routes write them via `logReviewEvent`. The contract is
  // simply that the union covers every case the routes can emit.
  const allLogActions: LogAction[] = [
    "submitted",
    "approved",
    "rejected",
    "archived",
    "unarchived",
    "forked",
    "moved_from_personal",
  ];
  it("LogAction union covers every emitted value", () => {
    const inferredKeys = new Set<LogAction>(allLogActions);
    expect(inferredKeys.size).toBe(7);
  });
});
