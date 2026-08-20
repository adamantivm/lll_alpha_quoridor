import { describe, expect, it } from "vitest";
import type { ModelEntry } from "./models";
import {
  aiRequestFor,
  awaitingHuman,
  createGameSession,
  statsMetaFor,
  type GameSetup,
  type NewGameRequest,
} from "./session";
import { createStatsReporter } from "./stats";
import type { StateView } from "./types";

const MODEL: ModelEntry = {
  id: "b9w10-v0",
  label: "9×9, 10 walls (v0)",
  isDefault: true,
  board_size: 9,
  max_walls: 10,
  max_steps: 100,
  defaults: { mcts_n: 800, mcts_c_puct: 1.4, leaf_parallelism: 8, virtual_loss: 1 },
};

const OTHER_MODEL: ModelEntry = {
  ...MODEL,
  id: "b5w2-mv1",
  label: "5×5, 2 walls (v1)",
  board_size: 5,
  max_walls: 2,
  max_steps: 60,
  defaults: { mcts_n: 200, mcts_c_puct: 1.1, leaf_parallelism: 4, virtual_loss: 2 },
};

function setup(over: Partial<GameSetup> = {}): GameSetup {
  return {
    model: MODEL,
    params: { mctsN: 800, cPuct: 1.4, leafParallelism: 8, virtualLoss: 1 },
    humanPlayer: 0,
    nick: "ada",
    ...over,
  };
}

/** Only the fields the lifecycle reads; the board itself is irrelevant here. */
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

type Payload = Record<string, unknown>;

/**
 * A session wired to the real stats reporter, so what is asserted is what would
 * reach the worker -- the reporter's own rules about finished and abandoned
 * games are part of the behaviour under test.
 */
function harness() {
  const requests: NewGameRequest[] = [];
  const sent: Payload[] = [];
  const nicks: string[] = [];

  const stats = createStatsReporter({
    endpoint: "https://stats.test/v1/games",
    appVersion: "test",
    clientId: "client-1",
    nick: () => "ada",
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)) as Payload);
      return new Response("{}");
    }) as unknown as typeof fetch,
  });

  const session = createGameSession({
    ai: { newGame: (r) => requests.push(r) },
    stats,
    locate: (m) => ({ modelUrl: `https://site.test/models/${m.id}/model.onnx`, ortBase: "https://site.test/ort/" }),
    persistNick: (n) => nicks.push(n),
  });

  return {
    session,
    requests,
    sent,
    nicks,
    statuses: () => sent.map((p) => p.status),
  };
}

describe("statsMetaFor / aiRequestFor", () => {
  it("describe the same game from the same setup", () => {
    const s = setup({ humanPlayer: 1, params: { mctsN: 64, cPuct: 2.1, leafParallelism: 4, virtualLoss: 3 } });
    const meta = statsMetaFor(s);
    const request = aiRequestFor(s, { modelUrl: "m.onnx", ortBase: "ort/" });

    expect(meta).toEqual({
      modelLabel: MODEL.label,
      modelId: MODEL.id,
      boardSize: 9,
      maxWalls: 10,
      maxSteps: 100,
      humanPlayer: 1,
      preset: "normal",
      mctsN: 64,
      cPuct: 2.1,
      leafParallelism: 4,
      virtualLoss: 3,
    });
    expect([request.boardSize, request.maxWalls, request.maxSteps]).toEqual([
      meta.boardSize,
      meta.maxWalls,
      meta.maxSteps,
    ]);
    expect(request.humanPlayer).toBe(meta.humanPlayer);
    expect(request.params).toEqual({
      mctsN: meta.mctsN,
      cPuct: meta.cPuct,
      leafParallelism: meta.leafParallelism,
      virtualLoss: meta.virtualLoss,
    });
  });

  it("copies the parameters, so a later edit cannot change a running game", () => {
    const s = setup();
    const request = aiRequestFor(s, { modelUrl: "m.onnx", ortBase: "ort/" });
    s.params.mctsN = 16;
    expect(request.params.mctsN).toBe(800);
  });
});

describe("awaitingHuman", () => {
  it("is true only on the human's turn, with the AI idle and the game live", () => {
    expect(awaitingHuman(null, false)).toBe(false);
    expect(awaitingHuman(view({ current_player: 0, human_player: 0 }), false)).toBe(true);
    expect(awaitingHuman(view({ current_player: 0, human_player: 0 }), true)).toBe(false);
    expect(awaitingHuman(view({ current_player: 1, human_player: 0 }), false)).toBe(false);
    expect(awaitingHuman(view({ current_player: 0, human_player: 0, winner: 1 }), false)).toBe(false);
  });
});

describe("the game lifecycle", () => {
  it("contacts nothing before the game is started", () => {
    const h = harness();
    // Setup lives entirely in the page until Start: choosing a model, moving a
    // slider or typing a name is not a game.
    statsMetaFor(setup({ model: OTHER_MODEL }));
    aiRequestFor(setup({ humanPlayer: 1 }), { modelUrl: "m.onnx", ortBase: "ort/" });
    expect(h.requests).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it("sends exactly one initialization, matching the record it writes", () => {
    const h = harness();
    const started = h.session.start(
      setup({
        model: OTHER_MODEL,
        humanPlayer: 1,
        params: { mctsN: 320, cPuct: 1.1, leafParallelism: 4, virtualLoss: 2 },
      }),
    );

    expect(started).toBe(true);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]).toEqual({
      modelUrl: "https://site.test/models/b5w2-mv1/model.onnx",
      ortBase: "https://site.test/ort/",
      boardSize: 5,
      maxWalls: 2,
      maxSteps: 60,
      humanPlayer: 1,
      params: { mctsN: 320, cPuct: 1.1, leafParallelism: 4, virtualLoss: 2 },
    });

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({
      status: "in_progress",
      model_id: "b5w2-mv1",
      model_label: OTHER_MODEL.label,
      board_size: 5,
      max_walls: 2,
      max_steps: 60,
      human_player: 1,
      mcts_n: 320,
      c_puct: 1.1,
      leaf_parallelism: 4,
      virtual_loss: 2,
    });
    expect(h.nicks).toEqual(["ada"]);
  });

  it("sends the chosen difficulty preset in the game record", () => {
    const h = harness();
    h.session.start(setup({ preset: "easy" }));
    expect(h.sent[0]).toMatchObject({ preset: "easy" });
  });

  it("refuses to start, and records nothing, without a name", () => {
    const h = harness();
    expect(h.session.start(setup({ nick: "   " }))).toBe(false);
    expect(h.requests).toEqual([]);
    expect(h.sent).toEqual([]);
    expect(h.nicks).toEqual([]);
  });

  it("leaves no open record when the game never initialises", () => {
    const h = harness();
    h.session.start(setup());
    // The worker could not load the model or start wasm: no position ever came.
    h.session.handleError();
    expect(h.statuses()).toEqual(["in_progress", "abandoned"]);

    // And going back to setup afterwards does not write it off twice.
    h.session.leave();
    expect(h.statuses()).toEqual(["in_progress", "abandoned"]);
  });

  it("keeps a running game when the worker errors after it has started", () => {
    const h = harness();
    h.session.start(setup());
    h.session.handleState(view({ move_history: [12], completed_steps: 1 }));
    h.session.handleError();
    expect(h.statuses()).toEqual(["in_progress", "in_progress"]);
  });

  it("records an unfinished game as abandoned exactly once on New Game", () => {
    const h = harness();
    h.session.start(setup());
    h.session.handleState(view({ move_history: [12], completed_steps: 1 }));
    h.session.leave();
    expect(h.statuses()).toEqual(["in_progress", "in_progress", "abandoned"]);

    h.session.leave();
    expect(h.sent).toHaveLength(3);
    // Nothing is recorded once the page is back on the setup screen either.
    h.session.handleState(view({ move_history: [12, 40], completed_steps: 2 }));
    expect(h.sent).toHaveLength(3);
  });

  it("does not turn a finished game into an abandoned one", () => {
    const h = harness();
    h.session.start(setup());
    h.session.handleState(view({ move_history: [12], completed_steps: 1, winner: 0 }));
    expect(h.statuses()).toEqual(["in_progress", "finished"]);

    h.session.leave();
    expect(h.statuses()).toEqual(["in_progress", "finished"]);
    expect(h.sent[1]).toMatchObject({ status: "finished", outcome: "human_win", winner: 0 });
  });

  it("starts the human as P1 with the human on turn", () => {
    const h = harness();
    h.session.start(setup({ humanPlayer: 0 }));
    const opening = view({ human_player: 0, current_player: 0, move_history: [] });
    h.session.handleState(opening);

    expect(h.requests[0].humanPlayer).toBe(0);
    expect(awaitingHuman(opening, false)).toBe(true);
    expect(h.sent[0]).toMatchObject({ human_player: 0, moves: [] });
  });

  // Choosing P2 makes the AI player 1, so the first position the page ever
  // sees already has the AI's opening move in it -- and that move belongs in
  // the record from the very first write after it.
  it("starts the human as P2 with the AI's opening move already played", () => {
    const h = harness();
    h.session.start(setup({ humanPlayer: 1 }));
    const afterAiOpening = view({
      human_player: 1,
      current_player: 1,
      move_history: [12],
      completed_steps: 1,
      last_action: { kind: "move", index: 12, to: [1, 4] },
    });
    h.session.handleState(afterAiOpening);

    expect(h.requests[0].humanPlayer).toBe(1);
    expect(h.sent[0]).toMatchObject({ human_player: 1 });
    expect(h.sent[1]).toMatchObject({ status: "in_progress", moves: [12] });
    // Control is with the human only after that move has been made.
    expect(awaitingHuman(afterAiOpening, false)).toBe(true);
    expect(awaitingHuman(view({ human_player: 1, current_player: 0 }), true)).toBe(false);
  });
});
