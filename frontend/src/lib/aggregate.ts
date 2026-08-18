/**
 * Turns recorded games into the numbers the stats page shows. Pure: it takes
 * the rows the API returned and returns plain objects, so every statistic here
 * is unit-tested rather than eyeballed in a table.
 *
 * Games are grouped by every search setting that can change how the AI plays:
 * model, mcts_n, c_puct, leaf parallelism and virtual loss. Batching settings
 * are in the key even though they are not meant to change the search's
 * conclusions -- the setup screen warns that they can, so a row that pooled
 * them would be a win rate for no one configuration in particular.
 *
 * Two conventions, both matching the play UI:
 *  - Player 1 is the side that moves first. The AI is player 1 exactly when
 *    `human_player === 1`.
 *  - Win rates count finished games only. An abandoned game has no result, and
 *    counting it as anything would bias the rate.
 */
import type { GameStatus, GameSummary } from "./statsApi";

/**
 * Shortest game worth keeping. A record is written the moment a game starts, so
 * the database collects visitors who opened the page and left, and the odd
 * single move on top of that -- neither says anything about anything. Raise this
 * if the noise floor moves.
 */
export const MIN_PLIES = 2;

/** Everything a barely-started game would only add noise to. */
export function dropTrivial(games: readonly GameSummary[]): GameSummary[] {
  return games.filter((g) => g.move_count >= MIN_PLIES);
}

export interface Filters {
  /** Drop games where the human took a move back: not clean strength samples. */
  excludeUndos: boolean;
  nick: string | null;
  appVersion: string | null;
  modelId: string | null;
  status: GameStatus | null;
}

export const DEFAULT_FILTERS: Filters = {
  excludeUndos: true,
  nick: null,
  appVersion: null,
  modelId: null,
  status: null,
};

export function applyFilters(games: readonly GameSummary[], f: Filters): GameSummary[] {
  return games.filter(
    (g) =>
      (!f.excludeUndos || g.undo_count === 0) &&
      (f.nick === null || g.nick === f.nick) &&
      (f.appVersion === null || g.app_version === f.appVersion) &&
      (f.modelId === null || g.model_id === f.modelId) &&
      (f.status === null || g.status === f.status),
  );
}

/** How the AI performed from one of the two seats. */
export interface SideStats {
  finished: number;
  aiWins: number;
  humanWins: number;
  draws: number;
  /** AI wins / finished games, or null when nothing has finished. */
  aiWinRate: number | null;
}

export interface MoveStats {
  mean: number;
  median: number;
  min: number;
  max: number;
}

export interface GroupStats {
  key: string;
  modelId: string;
  modelLabel: string;
  mctsN: number;
  cPuct: number;
  /** Every game in the group, including the ones with no result. */
  games: number;
  inProgress: number;
  abandoned: number;
  /** The AI's record over finished games, overall and from each seat. */
  overall: SideStats;
  aiFirst: SideStats;
  aiSecond: SideStats;
  /** Plies per finished game. Null when the group has no finished game. */
  moves: MoveStats | null;
  /** Mean plies split by who won, to show whether wins are quick or slow. */
  meanMovesAiWin: number | null;
  meanMovesHumanWin: number | null;
  leafParallelism: number;
  virtualLoss: number;
  lastPlayed: string;
}

export function groupKeyOf(g: GameSummary): string {
  return `${g.model_id}|${g.mcts_n}|${g.c_puct}|${g.leaf_parallelism}|${g.virtual_loss}`;
}

export function mean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Middle value, averaging the two middles on an even count. */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function sideStats(finished: readonly GameSummary[]): SideStats {
  const aiWins = finished.filter((g) => g.outcome === "ai_win").length;
  const humanWins = finished.filter((g) => g.outcome === "human_win").length;
  const draws = finished.filter((g) => g.outcome === "draw").length;
  return {
    finished: finished.length,
    aiWins,
    humanWins,
    draws,
    aiWinRate: finished.length === 0 ? null : aiWins / finished.length,
  };
}

function moveStats(finished: readonly GameSummary[]): MoveStats | null {
  if (finished.length === 0) return null;
  const plies = finished.map((g) => g.move_count);
  return {
    mean: mean(plies)!,
    median: median(plies)!,
    min: Math.min(...plies),
    max: Math.max(...plies),
  };
}

/**
 * One row per search configuration, most-played first. The label comes from
 * the group's most recent game: the id is the stable key, but a label can be
 * corrected without the id changing.
 */
export function groupGames(games: readonly GameSummary[]): GroupStats[] {
  const buckets = new Map<string, GameSummary[]>();
  for (const g of games) {
    const key = groupKeyOf(g);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(g);
    else buckets.set(key, [g]);
  }

  const rows = [...buckets].map(([key, bucket]) => {
    const finished = bucket.filter((g) => g.status === "finished");
    const newest = bucket.reduce((a, b) => (a.started_at >= b.started_at ? a : b));
    return {
      key,
      modelId: newest.model_id,
      modelLabel: newest.model_label,
      mctsN: newest.mcts_n,
      cPuct: newest.c_puct,
      games: bucket.length,
      inProgress: bucket.filter((g) => g.status === "in_progress").length,
      abandoned: bucket.filter((g) => g.status === "abandoned").length,
      overall: sideStats(finished),
      // The AI moves first exactly when the human chose to move second.
      aiFirst: sideStats(finished.filter((g) => g.human_player === 1)),
      aiSecond: sideStats(finished.filter((g) => g.human_player === 0)),
      moves: moveStats(finished),
      meanMovesAiWin: mean(finished.filter((g) => g.outcome === "ai_win").map((g) => g.move_count)),
      meanMovesHumanWin: mean(
        finished.filter((g) => g.outcome === "human_win").map((g) => g.move_count),
      ),
      leafParallelism: newest.leaf_parallelism,
      virtualLoss: newest.virtual_loss,
      lastPlayed: newest.started_at,
    };
  });

  return rows.sort(
    (a, b) =>
      b.games - a.games ||
      a.modelId.localeCompare(b.modelId) ||
      a.mctsN - b.mctsN ||
      a.cPuct - b.cPuct ||
      a.leafParallelism - b.leafParallelism ||
      a.virtualLoss - b.virtualLoss,
  );
}

export interface Totals {
  games: number;
  finished: number;
  inProgress: number;
  abandoned: number;
  players: number;
  models: number;
  first: string | null;
  last: string | null;
}

/** Header numbers, over the unfiltered set: what has been collected at all. */
export function totals(games: readonly GameSummary[]): Totals {
  const started = games.map((g) => g.started_at).sort();
  return {
    games: games.length,
    finished: games.filter((g) => g.status === "finished").length,
    inProgress: games.filter((g) => g.status === "in_progress").length,
    abandoned: games.filter((g) => g.status === "abandoned").length,
    players: new Set(games.map((g) => g.nick)).size,
    models: new Set(games.map((g) => g.model_id)).size,
    first: started[0] ?? null,
    last: started[started.length - 1] ?? null,
  };
}
