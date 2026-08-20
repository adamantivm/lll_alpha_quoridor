/**
 * Reads recorded games from the stats worker (see stats-worker/README.md).
 *
 * The build is given one URL, VITE_STATS_ENDPOINT, which is the worker's
 * `/v1/games` collection: the play page POSTs to it, and this page GETs the
 * list from it and one game from `${endpoint}/{game_id}`. Same deployment,
 * same origin allowlist, one thing to configure.
 *
 * `fetchImpl` is a parameter everywhere so this module tests without a network.
 */

export type GameStatus = "in_progress" | "finished" | "abandoned";
export type GameOutcome = "human_win" | "ai_win" | "draw";

/** One entry of the append-only log: a move played, or a takeback of n plies. */
export type ActionLogEntry = { m: number } | { u: number };

/**
 * A recorded game as the list endpoint returns it. Mirrors `GameSummary` in
 * stats-worker/src/sql.ts -- the two packages build separately, so the shape is
 * kept in step by hand.
 */
export interface GameSummary {
  game_id: string;
  started_at: string;
  updated_at: string;
  status: GameStatus;
  outcome: GameOutcome | null;
  winner: number | null;
  move_count: number;
  undo_count: number;
  rev: number;
  duration_ms: number;
  nick: string;
  schema_version: number;
  app_version: string | null;
  model_label: string;
  model_id: string;
  board_size: number;
  max_walls: number;
  max_steps: number;
  human_player: number;
  mcts_n: number;
  c_puct: number;
  leaf_parallelism: number;
  virtual_loss: number;
  webgpu_ok: boolean | null;
  country: string | null;
  preset: string;
}

/** One game, with the move list the replay viewer needs. */
export interface GameDetail extends GameSummary {
  moves: number[];
  action_log: ActionLogEntry[];
}

/** Rows per request. The worker's own ceiling is 500. */
export const PAGE_SIZE = 500;

/**
 * Most rows this page will load. A hard stop rather than an endless scroll: the
 * aggregation is client-side, and a table that grows past this should get a
 * server-side summary instead of a browser tab that stops responding.
 */
export const MAX_ROWS = 5000;

export type FetchLike = (url: string) => Promise<Response>;

/** Empty in dev and CI builds, exactly as reporting is disabled there. */
export function statsEndpoint(): string {
  return import.meta.env.VITE_STATS_ENDPOINT ?? "";
}

export function listUrl(endpoint: string, limit: number, cursor: string | null): string {
  const url = new URL(endpoint);
  url.searchParams.set("limit", String(limit));
  if (cursor !== null) url.searchParams.set("cursor", cursor);
  return url.href;
}

export function gameUrl(endpoint: string, gameId: string): string {
  return `${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(gameId)}`;
}

async function getJson(url: string, fetchImpl: FetchLike): Promise<unknown> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    // The worker answers errors as {"error": "..."}; fall back to the status.
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = `${detail}: ${body.error}`;
    } catch {
      // Not JSON. The status is all we have.
    }
    throw new Error(detail);
  }
  return res.json();
}

export interface GamesPage {
  games: GameSummary[];
  next_cursor: string | null;
}

function asPage(raw: unknown): GamesPage {
  const o = raw as { games?: unknown; next_cursor?: unknown };
  if (!o || !Array.isArray(o.games)) throw new Error("unexpected response from the stats API");
  return {
    games: o.games as GameSummary[],
    next_cursor: typeof o.next_cursor === "string" ? o.next_cursor : null,
  };
}

/**
 * Every game, newest first, following the cursor until the worker says there is
 * no more or MAX_ROWS is reached. `truncated` tells the page to say so rather
 * than quietly presenting a partial history as the whole one.
 */
export async function fetchAllGames(
  endpoint: string,
  fetchImpl: FetchLike,
  maxRows = MAX_ROWS,
): Promise<{ games: GameSummary[]; truncated: boolean }> {
  const games: GameSummary[] = [];
  let cursor: string | null = null;
  for (;;) {
    const room = maxRows - games.length;
    // Out of budget. The cursor only says the last page came back full, which
    // it does when the database holds exactly `maxRows` games, so ask for one
    // more row before telling anyone their history is being cut off.
    if (room <= 0) return { games, truncated: await hasMore(endpoint, cursor, fetchImpl) };
    const page = asPage(await getJson(listUrl(endpoint, Math.min(PAGE_SIZE, room), cursor), fetchImpl));
    games.push(...page.games);
    // A short page, or no cursor, means we have reached the end.
    if (page.next_cursor === null || page.games.length === 0) return { games, truncated: false };
    cursor = page.next_cursor;
  }
}

/** Is there at least one game past `cursor`? One row, asked once, at the cap. */
async function hasMore(
  endpoint: string,
  cursor: string | null,
  fetchImpl: FetchLike,
): Promise<boolean> {
  if (cursor === null) return false;
  return asPage(await getJson(listUrl(endpoint, 1, cursor), fetchImpl)).games.length > 0;
}

export async function fetchGame(
  endpoint: string,
  gameId: string,
  fetchImpl: FetchLike,
): Promise<GameDetail> {
  const raw = (await getJson(gameUrl(endpoint, gameId), fetchImpl)) as { game?: GameDetail };
  if (!raw?.game) throw new Error("unexpected response from the stats API");
  return raw.game;
}
