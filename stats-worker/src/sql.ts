/**
 * Every SQL statement this service runs, and the pure functions that build and
 * shape them. Kept apart from the HTTP handler so the statements can be
 * exercised against a real SQLite engine in tests -- the ordering guard and the
 * pagination predicate both live in SQL, so testing them any other way would
 * only test a paraphrase of them.
 */
import type { ActionLogEntry, GameOutcome, GameStatus, GameRecord } from "./record";

/**
 * Insert the record, or update the existing row when this write is newer.
 *
 * The guard is atomic: a stale write -- a late beacon, a retry that overtook
 * its predecessor, an undo that shortened the move list -- is dropped by the
 * database rather than by a read-then-write race in the worker. A finished game
 * is never touched again, and started_at keeps the first write's timestamp.
 */
export const UPSERT_SQL = `
INSERT INTO game (
  game_id, started_at, updated_at, status, outcome, winner, moves, move_count,
  action_log, undo_count, rev, duration_ms, client_id, nick, schema_version, app_version,
  model_label, model_id, board_size, max_walls, max_steps, human_player, preset,
  mcts_n, c_puct, leaf_parallelism, virtual_loss, webgpu_ok, ip, user_agent, country
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
)
ON CONFLICT(game_id) DO UPDATE SET
  updated_at = excluded.updated_at,
  status = excluded.status,
  outcome = excluded.outcome,
  winner = excluded.winner,
  moves = excluded.moves,
  move_count = excluded.move_count,
  action_log = excluded.action_log,
  undo_count = excluded.undo_count,
  rev = excluded.rev,
  duration_ms = excluded.duration_ms,
  -- Updatable so a nick chosen mid-game lands on the game it was chosen during.
  nick = excluded.nick
WHERE excluded.rev > game.rev AND game.status <> 'finished'`;

/** Where the request came from. Read from headers, never from the payload. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  country: string | null;
}

/**
 * Bind values for UPSERT_SQL, in placeholder order. Positional `?` rather than
 * numbered `?N` so the statement binds identically under D1 and under
 * node:sqlite in the tests -- which is why `now` appears twice, once for
 * started_at and once for updated_at.
 */
export function bindValues(
  r: GameRecord,
  now: string,
  meta: RequestMeta,
): (string | number | null)[] {
  return [
    r.game_id,
    now,
    now,
    r.status,
    r.outcome,
    r.winner,
    JSON.stringify(r.moves),
    r.moves.length,
    JSON.stringify(r.action_log),
    r.undo_count,
    r.rev,
    r.duration_ms,
    r.client_id,
    r.nick,
    r.schema_version,
    r.app_version,
    r.model_label,
    r.model_id,
    r.board_size,
    r.max_walls,
    r.max_steps,
    r.human_player,
    r.preset,
    r.mcts_n,
    r.c_puct,
    r.leaf_parallelism,
    r.virtual_loss,
    r.webgpu_ok === null ? null : r.webgpu_ok ? 1 : 0,
    meta.ip,
    meta.userAgent,
    meta.country,
  ];
}

// ---------------------------------------------------------------------------
// Reads: what the stats page fetches.
// ---------------------------------------------------------------------------

/**
 * The columns the read API exposes.
 *
 * `ip` and `user_agent` are deliberately absent and must stay absent: the stats
 * page is public, and no statistic on it needs either. `country` stays -- it is
 * coarse enough to show and interesting for "who plays this".
 *
 * `moves` and `action_log` are absent too, but only because they are big: one
 * game's worth is fetched by GAME_SQL when a game is opened for replay.
 */
export const SUMMARY_COLUMNS = [
  "game_id",
  "started_at",
  "updated_at",
  "status",
  "outcome",
  "winner",
  "move_count",
  "undo_count",
  "rev",
  "duration_ms",
  "nick",
  "schema_version",
  "app_version",
  "model_label",
  "model_id",
  "board_size",
  "max_walls",
  "max_steps",
  "human_player",
  "preset",
  "mcts_n",
  "c_puct",
  "leaf_parallelism",
  "virtual_loss",
  "webgpu_ok",
  "country",
] as const;

const SUMMARY_SELECT = SUMMARY_COLUMNS.join(", ");

/** One game as the list endpoint returns it. Mirrored in frontend/src/lib/statsApi.ts. */
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
  preset: string;
  mcts_n: number;
  c_puct: number;
  leaf_parallelism: number;
  virtual_loss: number;
  webgpu_ok: boolean | null;
  country: string | null;
}

/** A single game, with everything needed to replay it. */
export interface GameDetail extends GameSummary {
  moves: number[];
  action_log: ActionLogEntry[];
}

/** Everything needed to replay one game. */
export const GAME_SQL = `SELECT ${SUMMARY_SELECT}, moves, action_log FROM game WHERE game_id = ?`;

/** Page size when the caller does not ask, and the most we will ever return. */
export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 500;

/** Where a page of the list ended. Both halves are needed -- see listStatement(). */
export interface ListCursor {
  started_at: string;
  game_id: string;
}

export interface ListQuery {
  limit: number;
  cursor: ListCursor | null;
  status: GameStatus | null;
  outcome: GameOutcome | null;
  model_id: string | null;
}

const STATUSES: readonly string[] = ["in_progress", "finished", "abandoned"];
const OUTCOMES: readonly string[] = ["human_win", "ai_win", "draw"];

/** Catalogue ids are short slugs like `b9w10-v0`; anything longer is not one. */
const MAX_MODEL_ID = 64;

/** `started_at` is a server ISO timestamp, so it never contains the separator. */
export function encodeCursor(row: ListCursor): string {
  return `${row.started_at}|${row.game_id}`;
}

/**
 * Read the list endpoint's query string, or explain what is wrong with it.
 * A bad value is a 400 rather than a silent default: a caller paginating with a
 * cursor we cannot parse would otherwise loop over page one forever.
 */
export function parseListQuery(
  params: URLSearchParams,
): { ok: true; query: ListQuery } | { ok: false; error: string } {
  let limit = DEFAULT_LIMIT;
  const rawLimit = params.get("limit");
  if (rawLimit !== null) {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
      return { ok: false, error: `limit must be an integer in [1, ${MAX_LIMIT}]` };
    }
    limit = n;
  }

  let status: GameStatus | null = null;
  const rawStatus = params.get("status");
  if (rawStatus !== null) {
    if (!STATUSES.includes(rawStatus)) {
      return { ok: false, error: `status must be one of ${STATUSES.join("|")}` };
    }
    status = rawStatus as GameStatus;
  }

  let outcome: GameOutcome | null = null;
  const rawOutcome = params.get("outcome");
  if (rawOutcome !== null) {
    if (!OUTCOMES.includes(rawOutcome)) {
      return { ok: false, error: `outcome must be one of ${OUTCOMES.join("|")}` };
    }
    outcome = rawOutcome as GameOutcome;
  }

  // An exact match, not a search: this filters a list, it does not look a model
  // up, so an id nothing was played with is an empty page rather than a 404.
  let model_id: string | null = null;
  const rawModelId = params.get("model_id");
  if (rawModelId !== null) {
    if (!rawModelId || rawModelId.length > MAX_MODEL_ID) {
      return { ok: false, error: `model_id must be 1 to ${MAX_MODEL_ID} characters` };
    }
    model_id = rawModelId;
  }

  let cursor: ListCursor | null = null;
  const rawCursor = params.get("cursor");
  if (rawCursor !== null) {
    // Split on the FIRST separator: started_at cannot contain one, but a
    // game_id came from a client and in principle could.
    const at = rawCursor.indexOf("|");
    const started_at = at === -1 ? "" : rawCursor.slice(0, at);
    const game_id = at === -1 ? "" : rawCursor.slice(at + 1);
    if (!started_at || started_at.length > 40 || !game_id || game_id.length > 64) {
      return { ok: false, error: "cursor is not a valid page cursor" };
    }
    cursor = { started_at, game_id };
  }

  return { ok: true, query: { limit, cursor, status, outcome, model_id } };
}

/**
 * Build the list statement for a query.
 *
 * Newest first, and paginated by keyset rather than OFFSET so a game recorded
 * while someone is paging cannot shift rows onto a page that was already read.
 * The cursor compares the (started_at, game_id) pair because started_at is a
 * server timestamp with no uniqueness guarantee -- two games started in the
 * same millisecond with a plain `started_at <` would hide one of them.
 */
export function listStatement(q: ListQuery): { sql: string; binds: (string | number)[] } {
  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (q.status !== null) {
    where.push("status = ?");
    binds.push(q.status);
  }
  if (q.outcome !== null) {
    where.push("outcome = ?");
    binds.push(q.outcome);
  }
  if (q.model_id !== null) {
    where.push("model_id = ?");
    binds.push(q.model_id);
  }
  if (q.cursor !== null) {
    where.push("(started_at < ? OR (started_at = ? AND game_id < ?))");
    binds.push(q.cursor.started_at, q.cursor.started_at, q.cursor.game_id);
  }
  binds.push(q.limit);
  return {
    sql:
      `SELECT ${SUMMARY_SELECT} FROM game` +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      " ORDER BY started_at DESC, game_id DESC LIMIT ?",
    binds,
  };
}

function jsonArray(raw: unknown): unknown[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A row we cannot parse is a row we wrote wrong. Serving the rest of it
    // beats a 500 that hides every other field.
    return [];
  }
}

/**
 * Shape a row into the API's response object. Written out field by field on
 * purpose: it normalises SQLite's 1/0 back to a boolean, and it means a column
 * added to the table is not published by accident.
 */
export function rowToSummary(row: Record<string, unknown>): GameSummary {
  return {
    game_id: row.game_id as string,
    started_at: row.started_at as string,
    updated_at: row.updated_at as string,
    status: row.status as GameStatus,
    outcome: (row.outcome ?? null) as GameOutcome | null,
    winner: (row.winner ?? null) as number | null,
    move_count: row.move_count as number,
    undo_count: row.undo_count as number,
    rev: row.rev as number,
    duration_ms: row.duration_ms as number,
    nick: row.nick as string,
    schema_version: row.schema_version as number,
    app_version: (row.app_version ?? null) as string | null,
    model_label: row.model_label as string,
    model_id: row.model_id as string,
    board_size: row.board_size as number,
    max_walls: row.max_walls as number,
    max_steps: row.max_steps as number,
    human_player: row.human_player as number,
    preset: (row.preset ?? "unknown") as string,
    mcts_n: row.mcts_n as number,
    c_puct: row.c_puct as number,
    leaf_parallelism: row.leaf_parallelism as number,
    virtual_loss: row.virtual_loss as number,
    webgpu_ok: row.webgpu_ok === null || row.webgpu_ok === undefined ? null : !!row.webgpu_ok,
    country: (row.country ?? null) as string | null,
  };
}

export function rowToDetail(row: Record<string, unknown>): GameDetail {
  return {
    ...rowToSummary(row),
    moves: jsonArray(row.moves) as number[],
    action_log: jsonArray(row.action_log) as ActionLogEntry[],
  };
}
