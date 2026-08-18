/**
 * Reports played games to the stats worker (see stats-worker/ at the repo
 * root), which stores them in a Cloudflare D1 database.
 *
 * Two things shape this module. First, it must be impossible for stats to
 * affect play: every request is fire-and-forget and every failure is swallowed.
 * Second, a game abandoned mid-play is worth as much as a finished one -- people
 * tend to walk away exactly when the result becomes obvious -- so the record is
 * rewritten after every move rather than only at the end.
 *
 * Kept free of Svelte and of globals (fetch, localStorage and navigator are all
 * injectable) so the whole thing unit-tests as plain TypeScript.
 */
import type { StateView } from "./types";

export const STATS_SCHEMA_VERSION = 1;

/**
 * What a player is called when we do not have a name for them. The setup screen
 * requires one, so this covers older records and anything that reaches the
 * worker without one. Mirrored in stats-worker/src/record.ts.
 */
export const DEFAULT_NICK = "unknown";

/** Longest nick we send. Mirrors MAX_NICK_LENGTH in stats-worker/src/record.ts,
 *  which truncates anything longer rather than rejecting the game. */
export const MAX_NICK_LENGTH = 40;

const CLIENT_ID_KEY = "quoridor.stats.client_id";
const NICK_KEY = "quoridor.stats.nick";

/** Body content type. text/plain keeps each write a CORS *simple* request,
 *  which skips the preflight round trip -- worth having when we write once per
 *  move, and required for sendBeacon to be reliable during unload. */
const CONTENT_TYPE = "text/plain;charset=UTF-8";

export type Outcome = "human_win" | "ai_win" | "draw";
export type Status = "in_progress" | "finished" | "abandoned";

/** One entry of the append-only log: a move played, or a takeback of n plies. */
export type ActionLogEntry = { m: number } | { u: number };

/** Everything about a game that is fixed when it starts. */
export interface GameMeta {
  modelLabel: string;
  modelId: string;
  boardSize: number;
  maxWalls: number;
  maxSteps: number;
  humanPlayer: number;
  mctsN: number;
  cPuct: number;
  leafParallelism: number;
  virtualLoss: number;
}

export interface StatsReporter {
  /** Begin recording a new game. Ends tracking of any previous one. */
  startGame(meta: GameMeta): void;
  /** Called on every state push; writes only when something actually changed. */
  recordView(view: StateView): void;
  /** The player walked away: New game, or a model switch, mid-play. */
  abandonGame(): void;
  /** The tab went away. Marks the game abandoned but keeps recording, since
   *  a backgrounded tab on mobile is often resumed. */
  markHidden(): void;
}

export interface ReporterOptions {
  /** Empty disables reporting entirely -- the default outside production. */
  endpoint: string;
  appVersion: string;
  clientId: string;
  /**
   * Read at send time rather than at game start: the WebGPU probe is async and
   * has usually not answered yet when the page auto-starts its first game.
   */
  webgpuOk?: () => boolean | null;
  /**
   * The player's name, read at send time for the same reason: a nick chosen
   * part-way through should land on the game it was chosen during, not only on
   * the next one. Defaults to DEFAULT_NICK when the player leaves it blank.
   */
  nick?: () => string;
  fetchImpl?: typeof fetch;
  /** navigator.sendBeacon, or a stand-in. Used on the unload path only. */
  beaconImpl?: (url: string, body: Blob) => boolean;
  now?: () => number;
  newId?: () => string;
}

interface Game {
  id: string;
  meta: GameMeta;
  startedAt: number;
  rev: number;
  moves: number[];
  log: ActionLogEntry[];
  /** Set once a terminal state has been reported; nothing follows it. */
  finished: boolean;
  lastStatus: Status | null;
}

/**
 * How a game ended, or null if it has not. Two ways to be over: someone
 * reached the far side, or the step cap ran out -- the engine treats the cap as
 * game-over with no winner, which is a draw.
 */
export function outcomeFor(view: StateView): { outcome: Outcome; winner: number | null } | null {
  if (view.winner != null) {
    return {
      outcome: view.winner === view.human_player ? "human_win" : "ai_win",
      winner: view.winner,
    };
  }
  if (view.completed_steps >= view.max_steps) return { outcome: "draw", winner: null };
  return null;
}

/**
 * Turn a new move history into log entries, given the previous one. An undo
 * shortens the history, so the common prefix is what the two share: anything
 * the old list had beyond it was taken back, and anything the new list has
 * beyond it was played.
 */
export function diffMoves(prev: readonly number[], next: readonly number[]): ActionLogEntry[] {
  let p = 0;
  while (p < prev.length && p < next.length && prev[p] === next[p]) p++;
  const entries: ActionLogEntry[] = [];
  if (p < prev.length) entries.push({ u: prev.length - p });
  for (let i = p; i < next.length; i++) entries.push({ m: next[i] });
  return entries;
}

/** A stable anonymous id for this browser, so repeat visits are visible as
 *  such. Storage can throw (Safari private mode) or be absent; a per-session
 *  id is a fine fallback. */
export function getClientId(storage?: Storage, newId: () => string = randomId): string {
  try {
    const store = storage ?? globalThis.localStorage;
    const existing = store?.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const fresh = newId();
    store?.setItem(CLIENT_ID_KEY, fresh);
    return fresh;
  } catch {
    return newId();
  }
}

/** The nick this browser last played under, or "" if it has never been set.
 *  Same storage caveats as getClientId: absent or throwing storage just means
 *  the player types their name again. */
export function loadNick(storage?: Storage): string {
  try {
    const store = storage ?? globalThis.localStorage;
    return store?.getItem(NICK_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Remember the nick for next time. Blank clears it, so a player who wants to go
 *  back to anonymous is not stuck with a name the next visit re-fills. */
export function saveNick(nick: string, storage?: Storage): void {
  try {
    const store = storage ?? globalThis.localStorage;
    const trimmed = nick.trim().slice(0, MAX_NICK_LENGTH);
    if (trimmed) store?.setItem(NICK_KEY, trimmed);
    else store?.removeItem(NICK_KEY);
  } catch {
    // Not being able to remember a name is not worth breaking a game over.
  }
}

function randomId(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID();
  return `r${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function createStatsReporter(opts: ReporterOptions): StatsReporter {
  const {
    endpoint,
    appVersion,
    clientId,
    webgpuOk = () => null,
    nick = () => DEFAULT_NICK,
    fetchImpl,
    beaconImpl,
    now = () => Date.now(),
    newId = randomId,
  } = opts;

  let game: Game | null = null;

  function payload(g: Game, status: Status, ending: ReturnType<typeof outcomeFor>) {
    return {
      schema_version: STATS_SCHEMA_VERSION,
      game_id: g.id,
      rev: ++g.rev,
      status,
      outcome: ending?.outcome ?? null,
      winner: ending?.winner ?? null,
      moves: g.moves,
      action_log: g.log,
      undo_count: g.log.filter((e) => "u" in e).length,
      duration_ms: Math.max(0, Math.round(now() - g.startedAt)),
      client_id: clientId,
      nick: nick(),
      app_version: appVersion,
      model_label: g.meta.modelLabel,
      model_id: g.meta.modelId,
      board_size: g.meta.boardSize,
      max_walls: g.meta.maxWalls,
      max_steps: g.meta.maxSteps,
      human_player: g.meta.humanPlayer,
      mcts_n: g.meta.mctsN,
      c_puct: g.meta.cPuct,
      leaf_parallelism: g.meta.leafParallelism,
      virtual_loss: g.meta.virtualLoss,
      webgpu_ok: webgpuOk(),
    };
  }

  /** Fire and forget. Nothing here may throw or reject into the caller. */
  function send(g: Game, status: Status, ending: ReturnType<typeof outcomeFor>, unloading = false) {
    if (!endpoint) return;
    g.lastStatus = status;
    const body = JSON.stringify(payload(g, status, ending));
    try {
      if (unloading && beaconImpl) {
        beaconImpl(endpoint, new Blob([body], { type: CONTENT_TYPE }));
        return;
      }
      const f = fetchImpl ?? globalThis.fetch;
      // keepalive lets the request outlive the page, which matters for the
      // write that follows the last move before someone closes the tab.
      void f(endpoint, {
        method: "POST",
        headers: { "content-type": CONTENT_TYPE },
        body,
        keepalive: true,
      }).catch(() => {});
    } catch {
      // A synchronous throw (no fetch, a Blob constructor that dislikes us)
      // must not reach the game either.
    }
  }

  return {
    startGame(meta: GameMeta) {
      game = {
        id: newId(),
        meta,
        startedAt: now(),
        rev: 0,
        moves: [],
        log: [],
        finished: false,
        lastStatus: null,
      };
      // Recorded before a single move, so a visitor who opens the page and
      // leaves is still counted.
      send(game, "in_progress", null);
    },

    recordView(view: StateView) {
      const g = game;
      if (!g || g.finished) return;
      const entries = diffMoves(g.moves, view.move_history);
      const ending = outcomeFor(view);
      // Nothing new to say: same position, still running.
      if (entries.length === 0 && ending === null && g.lastStatus === "in_progress") return;
      g.log.push(...entries);
      g.moves = [...view.move_history];
      if (ending) g.finished = true;
      send(g, ending ? "finished" : "in_progress", ending);
    },

    abandonGame() {
      const g = game;
      if (!g || g.finished) return;
      // Only worth a write if there is a game in flight that we have not
      // already written off.
      if (g.lastStatus !== "abandoned") send(g, "abandoned", null);
      game = null;
    },

    markHidden() {
      const g = game;
      if (!g || g.finished || g.lastStatus === "abandoned") return;
      // Deliberately keeps `game` alive: a backgrounded tab is often resumed,
      // and the next write (with a higher rev) puts the game back in progress.
      send(g, "abandoned", null, true);
    },
  };
}
