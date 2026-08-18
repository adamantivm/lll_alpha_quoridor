import { describe, expect, it } from "vitest";
import { buildReplay, buildWarning, describePly, type ReplayEngine } from "./replay";
import type { StateView } from "./types";

function view(over: Partial<StateView> = {}): StateView {
  return {
    board_size: 9,
    max_walls: 10,
    max_steps: 100,
    current_player: 0,
    p1_pos: [0, 4],
    p2_pos: [8, 4],
    p1_walls: 10,
    p2_walls: 10,
    walls: [],
    legal_actions: [],
    completed_steps: 0,
    winner: null,
    human_player: 0,
    last_action: null,
    move_history: [],
    ...over,
  };
}

/** Stands in for the wasm Game: alternates the player, refuses `reject`. */
function fakeEngine(reject: number | null = null): ReplayEngine {
  let plies = 0;
  return {
    stateView: () => view(),
    applyAction: (index: number) => {
      if (index === reject) throw new Error(`action ${index} is not legal`);
      plies++;
      return view({
        current_player: plies % 2,
        completed_steps: plies,
        last_action: { kind: "move", index, to: [plies, index] },
      });
    },
  };
}

describe("buildReplay", () => {
  it("keeps one view per ply, opening position first", () => {
    const r = buildReplay(fakeEngine(), [12, 40, 17]);
    expect(r.views).toHaveLength(4);
    expect(r.views[0].completed_steps).toBe(0);
    expect(r.views[3].completed_steps).toBe(3);
    expect(r.stoppedAt).toBeNull();
    expect(r.error).toBeNull();
  });

  it("replays an empty game to just the opening position", () => {
    expect(buildReplay(fakeEngine(), []).views).toHaveLength(1);
  });

  // Only reachable if the rules changed under a stored game. Showing the prefix
  // beats showing an error page.
  it("stops at the refused ply and keeps what it has", () => {
    const r = buildReplay(fakeEngine(17), [12, 40, 17, 3]);
    expect(r.views).toHaveLength(3);
    expect(r.stoppedAt).toBe(2);
    expect(r.error).toMatch(/not legal/);
  });
});

describe("describePly", () => {
  it("credits the player who was on turn before the ply", () => {
    const before = view({ current_player: 1 });
    const after = view({ current_player: 0, last_action: { kind: "move", index: 40, to: [4, 4] } });
    expect(describePly(before, after)).toEqual({ mover: 1, text: "move to (4, 4)" });
  });

  it("describes a wall from the engine's own enriched action", () => {
    const after = view({
      last_action: { kind: "wall", index: 90, row: 3, col: 2, orientation: "h" },
    });
    expect(describePly(view(), after).text).toBe("wall h at (3, 2)");
  });

  it("has something to say about a position with no last action", () => {
    expect(describePly(view(), view()).text).toBe("—");
  });
});

describe("buildWarning", () => {
  it("says nothing when the game was recorded by this build", () => {
    expect(buildWarning("abc1234", "abc1234")).toBeNull();
  });

  it("warns when the replaying build is a different one", () => {
    const warning = buildWarning("abc1234", "def5678");
    expect(warning).toMatch(/different build/);
    expect(warning).toMatch(/rules/);
  });

  // Records predating the version stamp: nothing to compare, so say so rather
  // than imply the builds match.
  it("warns generically when the game carries no build", () => {
    expect(buildWarning(null, "def5678")).toMatch(/before builds were stamped/);
  });
});
