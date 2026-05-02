/**
 * Unit tests for the client reaction-delta reducer (Phase 4 / T036, T028).
 *
 * Exercises the pure `applyReactionDeltas` function without spinning up the
 * full hook + reducer harness. Covers idempotency (the hot rug-pull when
 * the SSE echo lands after the optimistic apply), thundering-herd batches,
 * count-zero chip cleanup, and the actor-list cap.
 */

import { describe, expect, it } from "vitest";
import {
  applyReactionDeltas,
  type ReactionDelta,
} from "@/components/threads/use-thread-stream";

type Reaction = {
  emoji: string;
  count: number;
  reactors: { userId: string; displayName: string | null }[];
  viewerReacted: boolean;
};

const fire = "🔥";
const eyes = "👀";
const heart = "❤️";

function delta(
  overrides: Partial<ReactionDelta> & {
    messageId: string;
    emoji: string;
    delta: "+1" | "-1";
    actorId: string;
  }
): ReactionDelta {
  return {
    actorDisplayName: overrides.actorDisplayName ?? "Sasha",
    isViewer: overrides.isViewer ?? false,
    ...overrides,
  };
}

describe("applyReactionDeltas — adds and removes", () => {
  it("adds a new chip when the emoji doesn't exist yet", () => {
    const out = applyReactionDeltas([], [
      delta({ messageId: "m1", emoji: fire, delta: "+1", actorId: "u1" }),
    ]);
    expect(out).toEqual<Reaction[]>([
      {
        emoji: fire,
        count: 1,
        reactors: [{ userId: "u1", displayName: "Sasha" }],
        viewerReacted: false,
      },
    ]);
  });

  it("flips viewerReacted when the viewer adds their own reaction", () => {
    const out = applyReactionDeltas([], [
      delta({
        messageId: "m1",
        emoji: fire,
        delta: "+1",
        actorId: "viewer",
        isViewer: true,
      }),
    ]);
    expect(out[0].viewerReacted).toBe(true);
  });

  it("increments the count when a different actor adds the same emoji", () => {
    const initial: Reaction[] = [
      {
        emoji: fire,
        count: 1,
        reactors: [{ userId: "u1", displayName: "Sasha" }],
        viewerReacted: false,
      },
    ];
    const out = applyReactionDeltas(initial, [
      delta({ messageId: "m1", emoji: fire, delta: "+1", actorId: "u2", actorDisplayName: "Mira" }),
    ]);
    expect(out[0].count).toBe(2);
    expect(out[0].reactors).toContainEqual({ userId: "u2", displayName: "Mira" });
  });

  it("removes a chip entirely when count hits 0", () => {
    const initial: Reaction[] = [
      {
        emoji: fire,
        count: 1,
        reactors: [{ userId: "u1", displayName: "Sasha" }],
        viewerReacted: false,
      },
    ];
    const out = applyReactionDeltas(initial, [
      delta({ messageId: "m1", emoji: fire, delta: "-1", actorId: "u1" }),
    ]);
    expect(out).toEqual([]);
  });

  it("drops the actor from reactors on -1 but keeps others", () => {
    const initial: Reaction[] = [
      {
        emoji: fire,
        count: 2,
        reactors: [
          { userId: "u1", displayName: "Sasha" },
          { userId: "u2", displayName: "Mira" },
        ],
        viewerReacted: false,
      },
    ];
    const out = applyReactionDeltas(initial, [
      delta({ messageId: "m1", emoji: fire, delta: "-1", actorId: "u1" }),
    ]);
    expect(out[0].count).toBe(1);
    expect(out[0].reactors).toEqual([{ userId: "u2", displayName: "Mira" }]);
  });
});

describe("applyReactionDeltas — idempotency", () => {
  it("ignores a duplicate +1 from the same actor", () => {
    const initial: Reaction[] = [
      {
        emoji: fire,
        count: 1,
        reactors: [{ userId: "u1", displayName: "Sasha" }],
        viewerReacted: false,
      },
    ];
    // Server echo arrives after the optimistic local apply — the second +1
    // must be a no-op or we'd double-count.
    const out = applyReactionDeltas(initial, [
      delta({ messageId: "m1", emoji: fire, delta: "+1", actorId: "u1" }),
    ]);
    expect(out[0].count).toBe(1);
    expect(out[0].reactors).toHaveLength(1);
  });

  it("ignores a -1 from an actor that wasn't reacting", () => {
    const initial: Reaction[] = [
      {
        emoji: fire,
        count: 1,
        reactors: [{ userId: "u1", displayName: "Sasha" }],
        viewerReacted: false,
      },
    ];
    const out = applyReactionDeltas(initial, [
      delta({ messageId: "m1", emoji: fire, delta: "-1", actorId: "u2" }),
    ]);
    expect(out).toEqual(initial);
  });
});

describe("applyReactionDeltas — batches", () => {
  it("applies many deltas across multiple emoji in one pass", () => {
    const initial: Reaction[] = [
      {
        emoji: fire,
        count: 1,
        reactors: [{ userId: "u1", displayName: "Sasha" }],
        viewerReacted: false,
      },
    ];
    const out = applyReactionDeltas(initial, [
      delta({ messageId: "m1", emoji: fire, delta: "+1", actorId: "u2", actorDisplayName: "Mira" }),
      delta({ messageId: "m1", emoji: eyes, delta: "+1", actorId: "u1" }),
      delta({ messageId: "m1", emoji: heart, delta: "+1", actorId: "u2", actorDisplayName: "Mira" }),
    ]);
    const fireRow = out.find((r) => r.emoji === fire)!;
    expect(fireRow.count).toBe(2);
    expect(out.find((r) => r.emoji === eyes)?.count).toBe(1);
    expect(out.find((r) => r.emoji === heart)?.count).toBe(1);
  });

  it("sorts most-reacted-first then alphabetically by emoji", () => {
    const initial: Reaction[] = [];
    const out = applyReactionDeltas(initial, [
      delta({ messageId: "m1", emoji: fire, delta: "+1", actorId: "u1" }),
      delta({ messageId: "m1", emoji: eyes, delta: "+1", actorId: "u1" }),
      delta({ messageId: "m1", emoji: eyes, delta: "+1", actorId: "u2", actorDisplayName: "Mira" }),
    ]);
    // eyes has count=2, fire has count=1 — eyes first.
    expect(out.map((r) => r.emoji)).toEqual([eyes, fire]);
  });
});

describe("applyReactionDeltas — reactor cap", () => {
  it("caps the reactors list at 8 even as count grows past it", () => {
    let rs: Reaction[] = [];
    const deltas: ReactionDelta[] = [];
    for (let i = 0; i < 12; i++) {
      deltas.push(
        delta({
          messageId: "m1",
          emoji: fire,
          delta: "+1",
          actorId: `u${i}`,
          actorDisplayName: `User ${i}`,
        })
      );
    }
    rs = applyReactionDeltas(rs, deltas);
    expect(rs[0].count).toBe(12);
    expect(rs[0].reactors).toHaveLength(8);
    // First-8 retained.
    expect(rs[0].reactors[0].userId).toBe("u0");
    expect(rs[0].reactors[7].userId).toBe("u7");
  });
});
