import { describe, expect, it } from "vitest";
import {
  applyFilters,
  DEFAULT_FILTERS,
  MIN_PLIES,
  dropTrivial,
  groupGames,
  groupKeyOf,
  median,
  totals,
} from "./aggregate";
import type { GameSummary } from "./statsApi";

/**
 * A recorded game. `human_player: 0` means the human moved first, so the AI is
 * P2; `human_player: 1` is the AI as P1.
 */
function game(over: Partial<GameSummary> = {}): GameSummary {
  return {
    game_id: "g",
    started_at: "2026-08-13T10:00:00.000Z",
    updated_at: "2026-08-13T10:05:00.000Z",
    status: "finished",
    outcome: "ai_win",
    winner: 1,
    move_count: 40,
    undo_count: 0,
    rev: 20,
    duration_ms: 60_000,
    nick: "ada",
    schema_version: 1,
    app_version: "abc1234",
    model_label: "9×9, 10 walls (v0)",
    model_id: "b9w10-v0",
    board_size: 9,
    max_walls: 10,
    max_steps: 100,
    human_player: 0,
    mcts_n: 1000,
    c_puct: 1.4,
    leaf_parallelism: 8,
    virtual_loss: 1,
    webgpu_ok: true,
    country: "UY",
    ...over,
  };
}

describe("median", () => {
  it("is the middle value, or the mean of the two middles", () => {
    expect(median([])).toBeNull();
    expect(median([7])).toBe(7);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("groupKeyOf", () => {
  it("keys on model, sims and c_puct only", () => {
    const a = game({ leaf_parallelism: 8, virtual_loss: 1 });
    const b = game({ leaf_parallelism: 32, virtual_loss: 3 });
    expect(groupKeyOf(a)).toBe(groupKeyOf(b));
    expect(groupKeyOf(game({ mcts_n: 200 }))).not.toBe(groupKeyOf(a));
    expect(groupKeyOf(game({ c_puct: 2 }))).not.toBe(groupKeyOf(a));
    expect(groupKeyOf(game({ model_id: "b5w2-mv1" }))).not.toBe(groupKeyOf(a));
  });
});

describe("groupGames", () => {
  it("splits the AI's record by the seat it played", () => {
    const [g] = groupGames([
      // AI as P1 (human chose to move second): 2 wins, 1 loss.
      game({ game_id: "1", human_player: 1, outcome: "ai_win" }),
      game({ game_id: "2", human_player: 1, outcome: "ai_win" }),
      game({ game_id: "3", human_player: 1, outcome: "human_win", winner: 1 }),
      // AI as P2: 1 win, 1 draw.
      game({ game_id: "4", human_player: 0, outcome: "ai_win" }),
      game({ game_id: "5", human_player: 0, outcome: "draw", winner: null }),
    ]);
    expect(g.games).toBe(5);
    expect(g.overall).toEqual({
      finished: 5,
      aiWins: 3,
      humanWins: 1,
      draws: 1,
      aiWinRate: 3 / 5,
    });
    expect(g.aiFirst).toEqual({
      finished: 3,
      aiWins: 2,
      humanWins: 1,
      draws: 0,
      aiWinRate: 2 / 3,
    });
    expect(g.aiSecond).toEqual({
      finished: 2,
      aiWins: 1,
      humanWins: 0,
      draws: 1,
      aiWinRate: 1 / 2,
    });
  });

  it("counts unfinished games but keeps them out of the rates", () => {
    const [g] = groupGames([
      game({ game_id: "1", outcome: "ai_win" }),
      game({ game_id: "2", status: "abandoned", outcome: null, winner: null }),
      game({ game_id: "3", status: "in_progress", outcome: null, winner: null }),
    ]);
    expect(g.games).toBe(3);
    expect(g.abandoned).toBe(1);
    expect(g.inProgress).toBe(1);
    expect(g.overall.finished).toBe(1);
    expect(g.overall.aiWinRate).toBe(1);
  });

  it("has no rate at all when nothing has finished", () => {
    const [g] = groupGames([game({ status: "abandoned", outcome: null, winner: null })]);
    expect(g.overall.aiWinRate).toBeNull();
    expect(g.moves).toBeNull();
    expect(g.meanMovesAiWin).toBeNull();
  });

  it("reports ply statistics over finished games, split by winner", () => {
    const [g] = groupGames([
      game({ game_id: "1", outcome: "ai_win", move_count: 20 }),
      game({ game_id: "2", outcome: "ai_win", move_count: 30 }),
      game({ game_id: "3", outcome: "human_win", winner: 0, move_count: 60 }),
      // Abandoned games have a move count too, and it must not count here.
      game({ game_id: "4", status: "abandoned", outcome: null, move_count: 4 }),
    ]);
    expect(g.moves).toEqual({ mean: (20 + 30 + 60) / 3, median: 30, min: 20, max: 60 });
    expect(g.meanMovesAiWin).toBe(25);
    expect(g.meanMovesHumanWin).toBe(60);
  });

  it("groups by settings and reports the parallelism seen, most played first", () => {
    const rows = groupGames([
      game({ game_id: "1", mcts_n: 200, leaf_parallelism: 8 }),
      game({ game_id: "2", mcts_n: 1000, leaf_parallelism: 8 }),
      game({ game_id: "3", mcts_n: 1000, leaf_parallelism: 32 }),
      game({ game_id: "4", mcts_n: 1000, leaf_parallelism: 32 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].mctsN).toBe(1000);
    expect(rows[0].games).toBe(3);
    expect(rows[0].leafParallelism).toEqual([8, 32]);
    expect(rows[1].games).toBe(1);
  });

  it("labels a group from its most recent game", () => {
    const [g] = groupGames([
      game({ game_id: "1", started_at: "2026-08-01T00:00:00.000Z", model_label: "old label" }),
      game({ game_id: "2", started_at: "2026-08-14T00:00:00.000Z", model_label: "new label" }),
    ]);
    expect(g.modelLabel).toBe("new label");
    expect(g.lastPlayed).toBe("2026-08-14T00:00:00.000Z");
  });
});

describe("dropTrivial", () => {
  // A record is written the moment a game starts, so the database collects
  // visitors who opened the page and left.
  it("drops games too short to say anything", () => {
    const kept = dropTrivial([
      game({ game_id: "opened", move_count: 0 }),
      game({ game_id: "one-move", move_count: 1 }),
      game({ game_id: "shortest-kept", move_count: MIN_PLIES }),
      game({ game_id: "real", move_count: 40 }),
    ]);
    expect(kept.map((g) => g.game_id)).toEqual(["shortest-kept", "real"]);
  });
});

describe("applyFilters", () => {
  const games = [
    game({ game_id: "1", undo_count: 2, nick: "ada" }),
    game({ game_id: "2", undo_count: 0, nick: "grace", model_id: "b5w2-mv1", app_version: "dev" }),
    game({ game_id: "3", undo_count: 0, nick: "ada", status: "abandoned", outcome: null }),
  ];
  const ids = (f: Parameters<typeof applyFilters>[1]) => applyFilters(games, f).map((g) => g.game_id);

  it("excludes takebacks by default", () => {
    expect(DEFAULT_FILTERS.excludeUndos).toBe(true);
    expect(ids(DEFAULT_FILTERS)).toEqual(["2", "3"]);
    expect(ids({ ...DEFAULT_FILTERS, excludeUndos: false })).toEqual(["1", "2", "3"]);
  });

  it("combines the other filters", () => {
    expect(ids({ ...DEFAULT_FILTERS, nick: "ada" })).toEqual(["3"]);
    expect(ids({ ...DEFAULT_FILTERS, status: "finished" })).toEqual(["2"]);
    expect(ids({ ...DEFAULT_FILTERS, modelId: "b5w2-mv1" })).toEqual(["2"]);
    expect(ids({ ...DEFAULT_FILTERS, appVersion: "dev" })).toEqual(["2"]);
    expect(ids({ ...DEFAULT_FILTERS, nick: "grace", modelId: "b9w10-v0" })).toEqual([]);
  });
});

describe("totals", () => {
  it("summarises what has been collected", () => {
    expect(
      totals([
        game({ game_id: "1", started_at: "2026-08-01T00:00:00.000Z", nick: "ada" }),
        game({ game_id: "2", started_at: "2026-08-14T00:00:00.000Z", nick: "grace", status: "abandoned" }),
        game({ game_id: "3", started_at: "2026-08-10T00:00:00.000Z", nick: "ada", status: "in_progress" }),
      ]),
    ).toEqual({
      games: 3,
      finished: 1,
      abandoned: 1,
      inProgress: 1,
      players: 2,
      models: 1,
      first: "2026-08-01T00:00:00.000Z",
      last: "2026-08-14T00:00:00.000Z",
    });
  });

  it("has no date range with no games", () => {
    expect(totals([]).first).toBeNull();
  });
});
