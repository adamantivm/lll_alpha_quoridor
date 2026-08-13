import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createStatsReporter,
  diffMoves,
  getClientId,
  outcomeFor,
  type GameMeta,
  type ReporterOptions,
} from "./stats";
import type { StateView } from "./types";

const META: GameMeta = {
  modelLabel: "9×9, 10 walls (v0)",
  modelId: "b9w10-v0",
  boardSize: 9,
  maxWalls: 10,
  maxSteps: 100,
  humanPlayer: 0,
  mctsN: 1000,
  cPuct: 1.4,
  leafParallelism: 8,
  virtualLoss: 1,
};

/** Only the fields the reporter reads; the rest of StateView is irrelevant here. */
function view(over: Partial<StateView> = {}): StateView {
  return {
    board_size: 9,
    max_walls: 10,
    max_steps: 100,
    current_player: 0,
    p1_pos: [8, 4],
    p2_pos: [0, 4],
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

/** A reporter wired to a fake fetch, plus the bodies it was handed. */
function setup(over: Partial<ReporterOptions> = {}) {
  const sent: Record<string, unknown>[] = [];
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response("{}");
  }) as unknown as typeof fetch;
  const beaconBodies: string[] = [];
  let n = 0;
  const reporter = createStatsReporter({
    endpoint: "https://stats.test/v1/games",
    appVersion: "abc1234",
    clientId: "client-1",
    webgpuOk: () => true,
    fetchImpl,
    beaconImpl: (_url, blob) => {
      // Blob.text() is async; the tests only need to know a beacon happened,
      // and the payload is asserted through the fetch path.
      beaconBodies.push(blob.type);
      return true;
    },
    now: () => 1_000_000,
    newId: () => `game-${++n}`,
    ...over,
  });
  return { reporter, sent, fetchImpl, beaconBodies };
}

describe("diffMoves", () => {
  it("reports appended moves", () => {
    expect(diffMoves([], [12])).toEqual([{ m: 12 }]);
    expect(diffMoves([12], [12, 40])).toEqual([{ m: 40 }]);
  });

  it("reports a takeback when the history shrinks", () => {
    expect(diffMoves([12, 40, 17, 3], [12, 40])).toEqual([{ u: 2 }]);
  });

  it("reports a takeback and the replacement together", () => {
    // Undo landed on the AI's turn, so it replied before the next state push.
    expect(diffMoves([12, 40, 17, 3], [12, 40, 9])).toEqual([{ u: 2 }, { m: 9 }]);
  });

  it("says nothing when the history is unchanged", () => {
    expect(diffMoves([12, 40], [12, 40])).toEqual([]);
  });
});

describe("outcomeFor", () => {
  it("attributes a win to the human or the AI", () => {
    expect(outcomeFor(view({ winner: 0, human_player: 0 }))).toEqual({
      outcome: "human_win",
      winner: 0,
    });
    expect(outcomeFor(view({ winner: 1, human_player: 0 }))).toEqual({
      outcome: "ai_win",
      winner: 1,
    });
  });

  it("treats the step cap as a draw", () => {
    // The engine calls the game over at the cap but reports no winner, and the
    // UI does not surface it -- the stats still should.
    expect(outcomeFor(view({ completed_steps: 100, max_steps: 100 }))).toEqual({
      outcome: "draw",
      winner: null,
    });
  });

  it("says nothing about a game still in progress", () => {
    expect(outcomeFor(view({ completed_steps: 12 }))).toBeNull();
  });
});

describe("createStatsReporter", () => {
  it("records a game before any move is played", () => {
    const { reporter, sent } = setup();
    reporter.startGame(META);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      schema_version: 1,
      game_id: "game-1",
      rev: 1,
      status: "in_progress",
      moves: [],
      action_log: [],
      undo_count: 0,
      client_id: "client-1",
      app_version: "abc1234",
      model_label: "9×9, 10 walls (v0)",
      model_id: "b9w10-v0",
      board_size: 9,
      mcts_n: 1000,
      webgpu_ok: true,
    });
  });

  it("reads the WebGPU verdict at send time, not at game start", () => {
    // The probe is async, so the first game usually starts before it answers.
    let ok: boolean | null = null;
    const { reporter, sent } = setup({ webgpuOk: () => ok });
    reporter.startGame(META);
    ok = false;
    reporter.recordView(view({ move_history: [12] }));
    expect(sent[0].webgpu_ok).toBeNull();
    expect(sent[1].webgpu_ok).toBe(false);
  });

  it("writes once per move and not at all when nothing changed", () => {
    const { reporter, sent } = setup();
    reporter.startGame(META);
    reporter.recordView(view({ move_history: [12] }));
    reporter.recordView(view({ move_history: [12, 40] }));
    reporter.recordView(view({ move_history: [12, 40] }));
    expect(sent).toHaveLength(3);
    expect(sent.map((s) => s.rev)).toEqual([1, 2, 3]);
    expect(sent[2].moves).toEqual([12, 40]);
  });

  it("keeps the taken-back move in the log while the move list shrinks", () => {
    const { reporter, sent } = setup();
    reporter.startGame(META);
    reporter.recordView(view({ move_history: [12, 40, 17, 3] }));
    reporter.recordView(view({ move_history: [12, 40] }));
    reporter.recordView(view({ move_history: [12, 40, 9, 22] }));
    const last = sent[sent.length - 1];
    expect(last.moves).toEqual([12, 40, 9, 22]);
    expect(last.action_log).toEqual([
      { m: 12 },
      { m: 40 },
      { m: 17 },
      { m: 3 },
      { u: 2 },
      { m: 9 },
      { m: 22 },
    ]);
    expect(last.undo_count).toBe(1);
  });

  it("reports a finished game exactly once", () => {
    const { reporter, sent } = setup();
    reporter.startGame(META);
    reporter.recordView(view({ move_history: [12], winner: 0, human_player: 0 }));
    reporter.recordView(view({ move_history: [12], winner: 0, human_player: 0 }));
    const finals = sent.filter((s) => s.status === "finished");
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ outcome: "human_win", winner: 0 });
  });

  it("abandons the previous game before starting the next", () => {
    const { reporter, sent } = setup();
    reporter.startGame(META);
    reporter.recordView(view({ move_history: [12, 40] }));
    reporter.abandonGame();
    reporter.startGame(META);
    expect(sent.map((s) => [s.game_id, s.status])).toEqual([
      ["game-1", "in_progress"],
      ["game-1", "in_progress"],
      ["game-1", "abandoned"],
      ["game-2", "in_progress"],
    ]);
    // The abandoned record still carries the moves played up to that point.
    expect(sent[2].moves).toEqual([12, 40]);
  });

  it("does not abandon a game that already finished", () => {
    const { reporter, sent } = setup();
    reporter.startGame(META);
    reporter.recordView(view({ move_history: [12], winner: 1, human_player: 0 }));
    reporter.abandonGame();
    reporter.markHidden();
    expect(sent.filter((s) => s.status === "abandoned")).toHaveLength(0);
  });

  it("beacons on hide but keeps recording if the player comes back", () => {
    const { reporter, sent, beaconBodies } = setup();
    reporter.startGame(META);
    reporter.recordView(view({ move_history: [12] }));
    reporter.markHidden();
    expect(beaconBodies).toHaveLength(1);
    // A second hide with nothing in between is not worth another write.
    reporter.markHidden();
    expect(beaconBodies).toHaveLength(1);
    // Back from the background: the game carries on and returns to in_progress.
    reporter.recordView(view({ move_history: [12, 40] }));
    const last = sent[sent.length - 1];
    expect(last).toMatchObject({ status: "in_progress", game_id: "game-1" });
    expect(last.moves).toEqual([12, 40]);
  });

  it("ignores everything when no endpoint is configured", () => {
    const { reporter, fetchImpl, beaconBodies } = setup({ endpoint: "" });
    reporter.startGame(META);
    reporter.recordView(view({ move_history: [12] }));
    reporter.markHidden();
    reporter.abandonGame();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(beaconBodies).toHaveLength(0);
  });

  it("survives a failing transport", async () => {
    const rejecting = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const { reporter } = setup({ fetchImpl: rejecting });
    expect(() => {
      reporter.startGame(META);
      reporter.recordView(view({ move_history: [12], winner: 0 }));
    }).not.toThrow();
    // Let the rejected promise settle; an unhandled rejection would fail the run.
    await Promise.resolve();
  });

  it("ignores state pushes before a game is started", () => {
    const { reporter, fetchImpl } = setup();
    reporter.recordView(view({ move_history: [12] }));
    reporter.abandonGame();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("getClientId", () => {
  let store: Record<string, string>;
  const storage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  } as Storage;

  beforeEach(() => {
    store = {};
  });

  it("mints an id once and reuses it", () => {
    let n = 0;
    const first = getClientId(storage, () => `id-${++n}`);
    const second = getClientId(storage, () => `id-${++n}`);
    expect(first).toBe("id-1");
    expect(second).toBe("id-1");
  });

  it("falls back to a throwaway id when storage is unavailable", () => {
    const hostile = {
      getItem() {
        throw new Error("private mode");
      },
      setItem() {
        throw new Error("private mode");
      },
    } as unknown as Storage;
    expect(getClientId(hostile, () => "fallback")).toBe("fallback");
  });
});
