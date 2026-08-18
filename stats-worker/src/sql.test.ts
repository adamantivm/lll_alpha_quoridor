/**
 * Exercises the statements in sql.ts against a real SQLite engine, using the
 * very schema.sql that gets applied to D1. The ordering guard and the
 * pagination predicate are both WHERE clauses, so asserting on anything less
 * than a real engine would only be testing a paraphrase.
 *
 * node:sqlite landed in Node 22; on older runtimes these tests skip rather than
 * fail, and the wrangler dev walkthrough in README.md covers the same ground.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { validate, type GameRecord } from "./record";
import {
  DEFAULT_LIMIT,
  GAME_SQL,
  MAX_LIMIT,
  SUMMARY_COLUMNS,
  UPSERT_SQL,
  bindValues,
  encodeCursor,
  listStatement,
  parseListQuery,
  rowToDetail,
  rowToSummary,
} from "./sql";

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): Row;
    all(...params: unknown[]): Record<string, string | number | null>[];
  };
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
    nick: "ada",
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
    expect(row.nick).toBe("ada");
  });

  // A nick chosen part-way through a game should attach to that game, not only
  // to the next one.
  it("lets a later write change the nick", () => {
    write({});
    write({ rev: 2, nick: "Grace" }, "2026-08-13T10:01:00.000Z");
    expect(read()!.nick).toBe("Grace");
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

describe("parseListQuery", () => {
  function q(search: string) {
    return parseListQuery(new URLSearchParams(search));
  }

  it("defaults to the newest page", () => {
    const r = q("");
    expect(r).toEqual({ ok: true, query: { limit: DEFAULT_LIMIT, cursor: null, status: null } });
  });

  it("accepts a limit, a status and a cursor", () => {
    const r = q(`limit=5&status=finished&cursor=${encodeURIComponent("2026-08-13T10:00:00.000Z|g-1")}`);
    expect(r).toEqual({
      ok: true,
      query: {
        limit: 5,
        status: "finished",
        cursor: { started_at: "2026-08-13T10:00:00.000Z", game_id: "g-1" },
      },
    });
  });

  // Silently defaulting a bad cursor would leave a paging caller looping over
  // page one for as long as it kept asking.
  it("rejects rather than defaults bad input", () => {
    for (const search of [
      "limit=0",
      `limit=${MAX_LIMIT + 1}`,
      "limit=abc",
      "limit=1.5",
      "status=whatever",
      "cursor=nopipe",
      "cursor=|g-1",
      "cursor=2026-08-13T10:00:00.000Z|",
    ]) {
      expect(q(search).ok, search).toBe(false);
    }
  });

  it("keeps a game id containing the separator whole", () => {
    const r = q("cursor=2026-08-13T10:00:00.000Z|a|b");
    expect(r.ok && r.query.cursor).toEqual({
      started_at: "2026-08-13T10:00:00.000Z",
      game_id: "a|b",
    });
  });
});

describe("SUMMARY_COLUMNS", () => {
  // The stats page is public. Neither column is needed by any statistic on it,
  // and shipping either would publish something we only collect server-side.
  it("does not expose the request metadata", () => {
    expect(SUMMARY_COLUMNS).not.toContain("ip");
    expect(SUMMARY_COLUMNS).not.toContain("user_agent");
  });

  it("names only real columns", () => {
    for (const col of SUMMARY_COLUMNS) {
      expect(schema, col).toContain(`  ${col} `);
    }
  });
});

describe.skipIf(!DatabaseSync)("read statements", () => {
  let db: SqliteDb;

  /** Games in insertion order; started_at is the second argument. */
  function seed(over: Record<string, unknown>, now: string) {
    db.prepare(UPSERT_SQL).run(...bindValues(record(over), now, meta));
  }

  function list(search: string) {
    const parsed = parseListQuery(new URLSearchParams(search));
    if (!parsed.ok) throw new Error(parsed.error);
    const { sql, binds } = listStatement(parsed.query);
    return db.prepare(sql).all(...binds).map(rowToSummary);
  }

  beforeEach(() => {
    db = new DatabaseSync!(":memory:");
    db.exec(schema);
    seed({ game_id: "g-old", status: "finished", outcome: "ai_win", winner: 1 }, "2026-08-13T10:00:00.000Z");
    seed({ game_id: "g-mid" }, "2026-08-13T11:00:00.000Z");
    // Same millisecond as g-mid: the pair comparison in the cursor is what
    // keeps one of these two from being skipped.
    seed({ game_id: "g-dup" }, "2026-08-13T11:00:00.000Z");
    seed({ game_id: "g-new", status: "abandoned" }, "2026-08-13T12:00:00.000Z");
  });

  it("lists newest first", () => {
    expect(list("").map((g) => g.game_id)).toEqual(["g-new", "g-mid", "g-dup", "g-old"]);
  });

  it("paginates without dropping games that share a timestamp", () => {
    const seen: string[] = [];
    let search = "limit=2";
    for (let page = 0; page < 5; page++) {
      const rows = list(search);
      seen.push(...rows.map((g) => g.game_id));
      if (rows.length < 2) break;
      search = `limit=2&cursor=${encodeURIComponent(encodeCursor(rows[rows.length - 1]))}`;
    }
    expect(seen).toEqual(["g-new", "g-mid", "g-dup", "g-old"]);
  });

  it("filters by status", () => {
    expect(list("status=finished").map((g) => g.game_id)).toEqual(["g-old"]);
    expect(list("status=in_progress").map((g) => g.game_id)).toEqual(["g-mid", "g-dup"]);
  });

  it("returns no request metadata and no move lists", () => {
    const parsed = parseListQuery(new URLSearchParams(""));
    if (!parsed.ok) throw new Error(parsed.error);
    const { sql, binds } = listStatement(parsed.query);
    const raw = db.prepare(sql).all(...binds);
    expect(Object.keys(raw[0]).sort()).toEqual([...SUMMARY_COLUMNS].sort());
  });

  it("shapes a summary row for the API", () => {
    const g = list("status=finished")[0];
    expect(g).toMatchObject({
      game_id: "g-old",
      started_at: "2026-08-13T10:00:00.000Z",
      status: "finished",
      outcome: "ai_win",
      winner: 1,
      move_count: 1,
      nick: "ada",
      model_id: "b9w10-v0",
      // 1 in SQLite, a boolean over the wire.
      webgpu_ok: true,
      country: "UY",
    });
  });

  it("reads one game with everything needed to replay it", () => {
    const row = db.prepare(GAME_SQL).get("g-old")!;
    const detail = rowToDetail(row);
    expect(detail.moves).toEqual([12]);
    expect(detail.action_log).toEqual([{ m: 12 }]);
    expect(detail.board_size).toBe(9);
    expect(detail.human_player).toBe(0);
    expect(detail).not.toHaveProperty("ip");
    expect(db.prepare(GAME_SQL).get("nope")).toBeUndefined();
  });
});
