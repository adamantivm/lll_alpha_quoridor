/**
 * Exercises UPSERT_SQL against a real SQLite engine, using the very schema.sql
 * that gets applied to D1. The ordering guard is a WHERE clause, so asserting
 * on anything less than a real engine would only be testing a paraphrase.
 *
 * node:sqlite landed in Node 22; on older runtimes these tests skip rather than
 * fail, and the wrangler dev walkthrough in README.md covers the same ground.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { validate, type GameRecord } from "./record";
import { UPSERT_SQL, bindValues } from "./sql";

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): { run(...params: unknown[]): unknown; get(...params: unknown[]): Row };
}
type Row = Record<string, string | number | null> | undefined;

let DatabaseSync: (new (path: string) => SqliteDb) | null = null;
try {
  // Loaded through createRequire, not import: vite resolves bare "node:sqlite"
  // against its own builtin list and fails there, while Node itself has it.
  ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite"));
} catch {
  // Node < 22: leave DatabaseSync null and skip the suite.
}

const schema = readFileSync(fileURLToPath(new URL("../schema.sql", import.meta.url)), "utf8");

function record(over: Record<string, unknown> = {}): GameRecord {
  const r = validate({
    schema_version: 1,
    game_id: "game-1",
    rev: 1,
    status: "in_progress",
    outcome: null,
    winner: null,
    moves: [12],
    action_log: [{ m: 12 }],
    undo_count: 0,
    duration_ms: 1000,
    client_id: "client-1",
    app_version: "abc1234",
    model_label: "9x9, 10 walls (v0)",
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
    ...over,
  });
  if (!r.ok) throw new Error(`fixture is invalid: ${r.error}`);
  return r.record;
}

const meta = { ip: "203.0.113.7", userAgent: "TestBrowser/1.0", country: "UY" };

describe.skipIf(!DatabaseSync)("UPSERT_SQL", () => {
  let db: SqliteDb;

  function write(over: Record<string, unknown>, now = "2026-08-13T10:00:00.000Z") {
    db.prepare(UPSERT_SQL).run(...bindValues(record(over), now, meta));
  }
  function read(): Row {
    return db.prepare("SELECT * FROM game WHERE game_id = 'game-1'").get();
  }

  beforeEach(() => {
    db = new DatabaseSync!(":memory:");
    db.exec(schema);
  });

  it("inserts a new game with the request metadata", () => {
    write({});
    const row = read()!;
    expect(row.status).toBe("in_progress");
    expect(row.moves).toBe("[12]");
    expect(row.move_count).toBe(1);
    expect(row.started_at).toBe("2026-08-13T10:00:00.000Z");
    expect(row.ip).toBe("203.0.113.7");
    expect(row.user_agent).toBe("TestBrowser/1.0");
    expect(row.country).toBe("UY");
    expect(row.webgpu_ok).toBe(1);
  });

  it("applies a newer revision and keeps the original started_at", () => {
    write({});
    write({ rev: 2, moves: [12, 40], action_log: [{ m: 12 }, { m: 40 }] }, "2026-08-13T10:01:00.000Z");
    const row = read()!;
    expect(row.rev).toBe(2);
    expect(row.moves).toBe("[12,40]");
    expect(row.move_count).toBe(2);
    expect(row.started_at).toBe("2026-08-13T10:00:00.000Z");
    expect(row.updated_at).toBe("2026-08-13T10:01:00.000Z");
  });

  it("ignores a stale revision", () => {
    write({ rev: 5, moves: [12, 40, 17], action_log: [{ m: 12 }, { m: 40 }, { m: 17 }] });
    // A beacon that overtook its predecessor, or a duplicate retry.
    write({ rev: 4, moves: [12], action_log: [{ m: 12 }] });
    write({ rev: 5, moves: [], action_log: [] });
    const row = read()!;
    expect(row.rev).toBe(5);
    expect(row.moves).toBe("[12,40,17]");
  });

  it("lets a shorter move list through when the revision is newer", () => {
    // What an undo looks like: the history really did get shorter, and the log
    // is what remembers the taken-back move.
    write({ rev: 1, moves: [12, 40, 17, 3], action_log: [{ m: 12 }, { m: 40 }, { m: 17 }, { m: 3 }] });
    write({
      rev: 2,
      moves: [12, 40],
      action_log: [{ m: 12 }, { m: 40 }, { m: 17 }, { m: 3 }, { u: 2 }],
      undo_count: 1,
    });
    const row = read()!;
    expect(row.moves).toBe("[12,40]");
    expect(row.move_count).toBe(2);
    expect(row.undo_count).toBe(1);
    expect(JSON.parse(String(row.action_log))).toHaveLength(5);
  });

  it("never overwrites a finished game", () => {
    write({ rev: 3, status: "finished", outcome: "human_win", winner: 0 });
    // The pagehide beacon fires after the win screen is shown.
    write({ rev: 4, status: "abandoned", outcome: null, winner: null });
    const row = read()!;
    expect(row.status).toBe("finished");
    expect(row.outcome).toBe("human_win");
    expect(row.rev).toBe(3);
  });

  it("records a draw with a null winner", () => {
    write({ rev: 2, status: "finished", outcome: "draw", winner: null });
    const row = read()!;
    expect(row.outcome).toBe("draw");
    expect(row.winner).toBeNull();
  });
});
