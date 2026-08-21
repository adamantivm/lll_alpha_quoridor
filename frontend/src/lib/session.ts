/**
 * The play page's game lifecycle: what "Start game" sends, what a state or an
 * error from the worker means, and when a record stops being a game in
 * progress.
 *
 * It lives outside App.svelte because that is where the sequencing bugs live --
 * the two halves of starting a game (tell the stats reporter, tell the AI
 * worker) can disagree, and a component that owns a worker is awkward to point
 * a test at. All the Svelte state stays in the component; this object holds one
 * fact, whether a playable position has arrived yet, and decides from it.
 */
import { modelUrl, ortBase, type ModelEntry } from "./models";
import { saveNick, type GameMeta, type StatsReporter } from "./stats";
import type { Difficulty } from "./difficulty";
import type { StateView } from "./types";

/** The search knobs the setup screen exposes. Fixed for a whole game. */
export interface SearchParams {
  mctsN: number;
  cPuct: number;
  leafParallelism: number;
  virtualLoss: number;
}

/** Everything the setup screen decides before a game exists. */
export interface GameSetup {
  model: ModelEntry;
  params: SearchParams;
  humanPlayer: number;
  nick: string;
  preset?: Difficulty;
}

/** The "newGame" message ai.worker.ts expects. */
export interface NewGameRequest {
  modelUrl: string;
  ortBase: string;
  boardSize: number;
  maxWalls: number;
  maxSteps: number;
  humanPlayer: number;
  params: SearchParams;
}

/** Where a model's weights and the ORT runtime are served from. */
export interface ModelUrls {
  modelUrl: string;
  ortBase: string;
}

/** Needs `location`, so it is injectable and the tests never call it. */
export function locateModel(model: ModelEntry): ModelUrls {
  return { modelUrl: modelUrl(model), ortBase: ortBase() };
}

/** What the game record says about the game being started. */
export function statsMetaFor(setup: GameSetup): GameMeta {
  return {
    modelLabel: setup.model.label,
    modelId: setup.model.id,
    boardSize: setup.model.board_size,
    maxWalls: setup.model.max_walls,
    maxSteps: setup.model.max_steps,
    humanPlayer: setup.humanPlayer,
    preset: setup.preset ?? "normal",
    mctsN: setup.params.mctsN,
    cPuct: setup.params.cPuct,
    leafParallelism: setup.params.leafParallelism,
    virtualLoss: setup.params.virtualLoss,
  };
}

/** What the worker is asked to play. Same setup as the record, by construction. */
export function aiRequestFor(setup: GameSetup, urls: ModelUrls): NewGameRequest {
  return {
    modelUrl: urls.modelUrl,
    ortBase: urls.ortBase,
    boardSize: setup.model.board_size,
    maxWalls: setup.model.max_walls,
    maxSteps: setup.model.max_steps,
    humanPlayer: setup.humanPlayer,
    params: { ...setup.params },
  };
}

/** True only when the human may act: their turn, game live, AI not working. */
export function awaitingHuman(view: StateView | null, thinking: boolean): boolean {
  return !!view && view.winner == null && view.current_player === view.human_player && !thinking;
}

/** The slice of AiClient the session drives. */
export interface SessionAi {
  newGame(request: NewGameRequest): void;
}

export interface SessionDeps {
  ai: SessionAi;
  stats: StatsReporter;
  locate?: (model: ModelEntry) => ModelUrls;
  /** Remember the nick for next visit. Injected only so tests stay off storage. */
  persistNick?: (nick: string) => void;
}

export interface GameSession {
  /**
   * Start a game. Returns false, having sent nothing, when there is no name to
   * record it under -- the same rule the setup screen's disabled button states.
   */
  start(setup: GameSetup): boolean;
  /** A position from the worker: the game is running, and worth recording. */
  handleState(view: StateView): void;
  /**
   * The worker failed. If it failed before ever producing a position -- a model
   * that will not load, wasm that will not start -- then the game never
   * happened, and the record written at start() must not sit in the database
   * as forever in progress.
   */
  handleError(): void;
  /** Back to the setup screen. Walking away mid-game is worth recording. */
  leave(): void;
}

export function createGameSession(deps: SessionDeps): GameSession {
  const { ai, stats, locate = locateModel, persistNick = saveNick } = deps;
  /** A game has been started here and not yet left. */
  let live = false;
  /** A position has arrived, so there is something the record describes. */
  let playable = false;

  return {
    start(setup: GameSetup): boolean {
      if (!setup.nick.trim()) return false;
      persistNick(setup.nick);
      live = true;
      playable = false;
      stats.startGame(statsMetaFor(setup));
      ai.newGame(aiRequestFor(setup, locate(setup.model)));
      return true;
    },

    handleState(view: StateView): void {
      if (!live) return;
      playable = true;
      stats.recordView(view);
    },

    handleError(): void {
      if (!live || playable) return;
      stats.abandonGame();
      live = false;
    },

    leave(): void {
      if (!live) return;
      // A no-op for a game that already finished: abandonGame() will not
      // overwrite a result, so closing a won game keeps it won.
      stats.abandonGame();
      live = false;
    },
  };
}
