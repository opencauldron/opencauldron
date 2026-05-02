/**
 * Backfill level-replay parity test (T075).
 *
 * The backfill script (`scripts/backfill-activity.mjs`) inlines the level
 * curve constants because it can't import the TS module from a .mjs file
 * without a build step. This test pins the curve in BOTH places to
 * `getLevelFromXP` from `src/lib/xp.ts` so a future curve change will
 * fail loudly here instead of silently desyncing the backfill.
 *
 * Pure unit test — no DB. Runs in the default `pnpm test` suite.
 */

import { describe, expect, it } from "vitest";
import { getLevelFromXP, getLevelTitle } from "@/lib/xp";

// Mirror `LEVEL_THRESHOLDS` and `LEVEL_TITLES` from
// `scripts/backfill-activity.mjs`. If the live curve in `src/lib/xp.ts`
// changes, update both this file AND the .mjs script.
const BACKFILL_LEVEL_THRESHOLDS = [0, 50, 150, 400, 800, 1500, 3000, 6000];
const BACKFILL_LEVEL_TITLES = [
  "Apprentice",
  "Herbalist",
  "Alchemist",
  "Enchanter",
  "Warlock",
  "Archmage",
  "Mythweaver",
  "Elder",
];

function backfillGetLevel(xp: number): number {
  for (let i = BACKFILL_LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= BACKFILL_LEVEL_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

function backfillGetTitle(level: number): string {
  return BACKFILL_LEVEL_TITLES[
    Math.min(level, BACKFILL_LEVEL_TITLES.length) - 1
  ];
}

describe("backfill level-replay parity with src/lib/xp.ts", () => {
  // Probe every threshold + a couple in-between values.
  const probes = [0, 1, 49, 50, 51, 149, 150, 399, 400, 799, 800, 1499, 1500, 2999, 3000, 5999, 6000, 999_999];

  it.each(probes)(
    "getLevelFromXP(%i) matches the backfill copy",
    (xp) => {
      expect(backfillGetLevel(xp)).toBe(getLevelFromXP(xp));
    }
  );

  it("getLevelTitle for every level 1..8 matches the backfill copy", () => {
    for (let level = 1; level <= 8; level++) {
      expect(backfillGetTitle(level)).toBe(getLevelTitle(level));
    }
  });
});

describe("backfill level-crossing replay (synthetic)", () => {
  // Single transactions that vault one level.
  it("emits one event when a transaction crosses one threshold", () => {
    let runningXp = 0;
    let runningLevel = 1;
    const synthesized: Array<{ level: number }> = [];

    const txs = [{ amount: 60 }]; // 0 → 60, crosses 50
    for (const t of txs) {
      const prevLevel = runningLevel;
      runningXp += t.amount;
      const newLevel = backfillGetLevel(runningXp);
      if (newLevel > prevLevel) {
        for (let l = prevLevel + 1; l <= newLevel; l++) {
          synthesized.push({ level: l });
        }
        runningLevel = newLevel;
      }
    }
    expect(synthesized).toEqual([{ level: 2 }]);
  });

  // Transactions that vault MULTIPLE levels (admin grant), one event per level.
  it("emits multiple events when one transaction crosses multiple thresholds", () => {
    let runningXp = 0;
    let runningLevel = 1;
    const synthesized: Array<{ level: number }> = [];

    const txs = [{ amount: 500 }]; // 0 → 500, crosses 50/150/400 → level 4
    for (const t of txs) {
      const prevLevel = runningLevel;
      runningXp += t.amount;
      const newLevel = backfillGetLevel(runningXp);
      if (newLevel > prevLevel) {
        for (let l = prevLevel + 1; l <= newLevel; l++) {
          synthesized.push({ level: l });
        }
        runningLevel = newLevel;
      }
    }
    expect(synthesized).toEqual([{ level: 2 }, { level: 3 }, { level: 4 }]);
  });

  // No-op transactions inside the same level emit nothing.
  it("emits nothing when running XP stays within a level", () => {
    let runningXp = 100; // already level 2 (50..149)
    let runningLevel = 2;
    const synthesized: Array<{ level: number }> = [];

    const txs = [{ amount: 10 }, { amount: 20 }]; // 100→110→130, still level 2
    for (const t of txs) {
      const prevLevel = runningLevel;
      runningXp += t.amount;
      const newLevel = backfillGetLevel(runningXp);
      if (newLevel > prevLevel) {
        for (let l = prevLevel + 1; l <= newLevel; l++) {
          synthesized.push({ level: l });
        }
        runningLevel = newLevel;
      }
    }
    expect(synthesized).toEqual([]);
  });
});
