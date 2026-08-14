/**
 * The single write this service performs. Kept apart from the HTTP handler so
 * the statement can be exercised against a real SQLite engine in tests -- the
 * ordering guard lives in SQL, so testing it any other way would only test a
 * paraphrase of it.
 */
import type { GameRecord } from "./record";

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
  model_label, model_id, board_size, max_walls, max_steps, human_player,
  mcts_n, c_puct, leaf_parallelism, virtual_loss, webgpu_ok, ip, user_agent, country
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
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
