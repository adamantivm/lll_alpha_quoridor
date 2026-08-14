/**
 * Payload shape and validation for a game record, kept free of any Workers
 * runtime import so it unit-tests as plain TypeScript.
 *
 * The client sends the *whole* record on every write, not a start payload
 * followed by deltas. It costs a few hundred bytes and means a row is complete
 * even if the first POST of a game is the one that gets dropped.
 */

export const SCHEMA_VERSION = 1;

/**
 * What a player is called when we do not know: nothing asks for a nick yet.
 * Also the fallback for a client too old to send the field, since the worker
 * and the cached bundle deploy separately. Mirrored in frontend/src/lib/stats.ts.
 */
export const DEFAULT_NICK = "unknown";

/** Longest nick we store. Long enough for a real name, short enough not to be a payload. */
export const MAX_NICK_LENGTH = 40;

/** Longest body we will read, before parsing. A 100-move game is well under 4 KB. */
export const MAX_BODY_BYTES = 64 * 1024;

export type GameStatus = "in_progress" | "finished" | "abandoned";
export type GameOutcome = "human_win" | "ai_win" | "draw";

/** One entry of the append-only log: a move played, or a takeback of n plies. */
export type ActionLogEntry = { m: number } | { u: number };

export interface GameRecord {
  game_id: string;
  rev: number;
  schema_version: number;
  status: GameStatus;
  outcome: GameOutcome | null;
  winner: number | null;
  moves: number[];
  action_log: ActionLogEntry[];
  undo_count: number;
  duration_ms: number;
  client_id: string;
  nick: string;
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
}

export type Validated = { ok: true; record: GameRecord } | { ok: false; error: string };

/**
 * Size of the action space for a board: N*N pawn destinations, then one
 * vertical and one horizontal wall slot per interior intersection. Mirrors the
 * layout in rust/src/actions.rs -- see enrich_action() in quoridor-wasm.
 */
export function actionSpaceSize(boardSize: number): number {
  return boardSize * boardSize + 2 * (boardSize - 1) * (boardSize - 1);
}

const STATUSES: readonly string[] = ["in_progress", "finished", "abandoned"];
const OUTCOMES: readonly string[] = ["human_win", "ai_win", "draw"];

function str(o: Record<string, unknown>, key: string, maxLen: number): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) throw new Error(`${key} must be a non-empty string`);
  if (v.length > maxLen) throw new Error(`${key} exceeds ${maxLen} characters`);
  return v;
}

function optStr(o: Record<string, unknown>, key: string, maxLen: number): string | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new Error(`${key} must be a string or null`);
  return v.slice(0, maxLen);
}

/**
 * The player's chosen name. Tolerant on purpose: an absent, blank or
 * over-long nick falls back or is trimmed rather than costing us the whole game
 * record, since it is cosmetic and the field is newer than some clients.
 * Control characters go, so a nick stays one printable line wherever it is shown.
 */
export function parseNick(raw: unknown): string {
  if (raw === undefined || raw === null) return DEFAULT_NICK;
  if (typeof raw !== "string") throw new Error("nick must be a string or null");
  // \u0000-\u001F and \u007F: newlines, NULs and friends have no business in a display name.
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, MAX_NICK_LENGTH).trim();
  return cleaned.length > 0 ? cleaned : DEFAULT_NICK;
}

function int(o: Record<string, unknown>, key: string, min: number, max: number): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${key} must be an integer in [${min}, ${max}]`);
  }
  return v;
}

function num(o: Record<string, unknown>, key: string, min: number, max: number): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    throw new Error(`${key} must be a finite number in [${min}, ${max}]`);
  }
  return v;
}

/**
 * Parse an untrusted body into a GameRecord, or explain why it is not one.
 * Ranges are deliberately generous: the point is to bound what a hostile client
 * can write to the database, not to re-implement the rules.
 */
export function validate(body: unknown): Validated {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const o = body as Record<string, unknown>;
  try {
    if (o.schema_version !== SCHEMA_VERSION) {
      throw new Error(`schema_version must be ${SCHEMA_VERSION}`);
    }

    const board_size = int(o, "board_size", 3, 25);
    const max_steps = int(o, "max_steps", 1, 10_000);
    const limit = actionSpaceSize(board_size);

    const status = str(o, "status", 16) as GameStatus;
    if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join("|")}`);

    const rawOutcome = o.outcome;
    if (rawOutcome !== undefined && rawOutcome !== null && typeof rawOutcome !== "string") {
      throw new Error("outcome must be a string or null");
    }
    const outcome = (rawOutcome ?? null) as GameOutcome | null;
    if (outcome !== null && !OUTCOMES.includes(outcome)) {
      throw new Error(`outcome must be one of ${OUTCOMES.join("|")}`);
    }
    if (status === "finished" && outcome === null) {
      throw new Error("a finished game must carry an outcome");
    }

    const rawWinner = o.winner;
    if (rawWinner !== undefined && rawWinner !== null && rawWinner !== 0 && rawWinner !== 1) {
      throw new Error("winner must be 0, 1 or null");
    }
    const winner = (rawWinner ?? null) as number | null;

    if (!Array.isArray(o.moves)) throw new Error("moves must be an array");
    if (o.moves.length > max_steps) throw new Error("moves is longer than max_steps");
    const moves = o.moves.map((v, i) => {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v >= limit) {
        throw new Error(`moves[${i}] is not a valid action index for a ${board_size}x${board_size} board`);
      }
      return v;
    });

    // Every ply can in principle be played, taken back and replayed, so the log
    // is allowed to be several times the move list -- but not unbounded.
    if (!Array.isArray(o.action_log)) throw new Error("action_log must be an array");
    if (o.action_log.length > max_steps * 8) throw new Error("action_log is implausibly long");
    const action_log = o.action_log.map((raw, i) => {
      if (typeof raw !== "object" || raw === null) throw new Error(`action_log[${i}] must be an object`);
      const e = raw as Record<string, unknown>;
      if (typeof e.m === "number") {
        if (!Number.isInteger(e.m) || e.m < 0 || e.m >= limit) {
          throw new Error(`action_log[${i}].m is not a valid action index`);
        }
        return { m: e.m } as ActionLogEntry;
      }
      if (typeof e.u === "number") {
        if (!Number.isInteger(e.u) || e.u < 1 || e.u > max_steps) {
          throw new Error(`action_log[${i}].u is not a plausible takeback length`);
        }
        return { u: e.u } as ActionLogEntry;
      }
      throw new Error(`action_log[${i}] must have a numeric "m" or "u"`);
    });

    const rawGpu = o.webgpu_ok;
    if (rawGpu !== undefined && rawGpu !== null && typeof rawGpu !== "boolean") {
      throw new Error("webgpu_ok must be a boolean or null");
    }

    return {
      ok: true,
      record: {
        game_id: str(o, "game_id", 64),
        rev: int(o, "rev", 1, 1_000_000),
        schema_version: SCHEMA_VERSION,
        status,
        outcome,
        winner,
        moves,
        action_log,
        undo_count: int(o, "undo_count", 0, 10_000),
        // A day is far longer than any real game and keeps a bogus clock from
        // poisoning duration averages.
        duration_ms: int(o, "duration_ms", 0, 86_400_000),
        client_id: str(o, "client_id", 64),
        nick: parseNick(o.nick),
        app_version: optStr(o, "app_version", 64),
        model_label: str(o, "model_label", 120),
        model_id: str(o, "model_id", 64),
        board_size,
        max_walls: int(o, "max_walls", 0, 100),
        max_steps,
        human_player: int(o, "human_player", 0, 1),
        mcts_n: int(o, "mcts_n", 1, 1_000_000),
        c_puct: num(o, "c_puct", 0, 1000),
        leaf_parallelism: int(o, "leaf_parallelism", 1, 4096),
        virtual_loss: num(o, "virtual_loss", 0, 1000),
        webgpu_ok: (rawGpu ?? null) as boolean | null,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
