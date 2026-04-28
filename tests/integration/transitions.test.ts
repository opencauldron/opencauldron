/**
 * Pure-function tests for the asset state-machine matrix (FR-009 / NFR-003).
 *
 * Covers the full from→to / action grid in `ALLOWED_TRANSITIONS`. The DB-
 * touching wrapper `transitionAsset` is a thin shim around the pure
 * `validateTransition` helper; the SQL side is verified separately by the
 * approval-flow integration test (T101) when an integration DB is wired up.
 */

import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  TransitionError,
  validateTransition,
  type AssetStatus,
  type TransitionAction,
} from "@/lib/transitions";

const STATUSES: AssetStatus[] = [
  "draft",
  "in_review",
  "approved",
  "rejected",
  "archived",
];
const ACTIONS: TransitionAction[] = [
  "submit",
  "approve",
  "reject",
  "archive",
  "unarchive",
];

// Source of truth — every (status, action) cell. The asserted target status
// here mirrors plan.md "Asset state machine" exactly so a behavior change
// shows up as a one-line diff.
const EXPECTED: Record<AssetStatus, Partial<Record<TransitionAction, AssetStatus>>> = {
  draft: {
    submit: "in_review",
    archive: "archived",
  },
  in_review: {
    approve: "approved",
    reject: "rejected",
    archive: "archived",
  },
  approved: {
    archive: "archived",
  },
  rejected: {
    archive: "archived",
  },
  archived: {
    unarchive: "draft",
  },
};

describe("asset state-machine matrix", () => {
  describe("legal transitions", () => {
    for (const status of STATUSES) {
      for (const action of ACTIONS) {
        const expectedTo = EXPECTED[status][action];
        if (!expectedTo) continue;
        it(`${status} + ${action} → ${expectedTo}`, () => {
          const rule = validateTransition(status, action);
          expect(rule.to).toBe(expectedTo);
        });
      }
    }
  });

  describe("illegal transitions", () => {
    for (const status of STATUSES) {
      for (const action of ACTIONS) {
        if (EXPECTED[status][action]) continue;
        it(`${status} + ${action} throws invalid_transition (409)`, () => {
          expect(() => validateTransition(status, action)).toThrow(
            TransitionError
          );
          try {
            validateTransition(status, action);
          } catch (err) {
            expect(err).toBeInstanceOf(TransitionError);
            const e = err as TransitionError;
            expect(e.status).toBe(409);
            expect(e.code).toBe("invalid_transition");
          }
        });
      }
    }
  });

  describe("log action mapping", () => {
    it("maps every action to the audit-log action enum", () => {
      expect(ALLOWED_TRANSITIONS.submit.logAction).toBe("submitted");
      expect(ALLOWED_TRANSITIONS.approve.logAction).toBe("approved");
      expect(ALLOWED_TRANSITIONS.reject.logAction).toBe("rejected");
      expect(ALLOWED_TRANSITIONS.archive.logAction).toBe("archived");
      expect(ALLOWED_TRANSITIONS.unarchive.logAction).toBe("unarchived");
    });
  });

  describe("invariants", () => {
    it("approve requires in_review (no draft → approved skip)", () => {
      expect(() => validateTransition("draft", "approve")).toThrow(
        TransitionError
      );
    });
    it("submit cannot run on already-submitted assets (no double-submit)", () => {
      expect(() => validateTransition("in_review", "submit")).toThrow(
        TransitionError
      );
    });
    it("approved is a terminal status except via archive", () => {
      // approve / reject / submit / unarchive must all be illegal from approved
      for (const action of ["approve", "reject", "submit", "unarchive"] as const) {
        expect(() => validateTransition("approved", action)).toThrow(
          TransitionError
        );
      }
      // archive is the only legal exit
      expect(validateTransition("approved", "archive").to).toBe("archived");
    });
    it("archived restores to draft (resets the lifecycle)", () => {
      expect(validateTransition("archived", "unarchive").to).toBe("draft");
    });
  });
});
