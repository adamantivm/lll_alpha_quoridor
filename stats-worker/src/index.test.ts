import { describe, expect, it } from "vitest";
import worker, { type Env } from "./index";

interface Captured {
  sql: string;
  params: unknown[];
}

/** A D1 stand-in that records what it was asked to run and replays fixed rows. */
function fakeDb(fail = false, rows: Record<string, unknown>[] = []) {
  const calls: Captured[] = [];
  const DB = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          const record = () => {
            if (fail) throw new Error("d1 is down");
            calls.push({ sql, params });
          };
          return {
            async run() {
              record();
              return {};
            },
            async all() {
              record();
              return { results: rows };
            },
            async first() {
              record();
              return rows[0] ?? null;
            },
          };
        },
      };
    },
  };
  return { DB: DB as unknown as Env["DB"], calls };
}

/** A row as the read statements select it: every SUMMARY_COLUMNS field. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    game_id: "game-1",
    started_at: "2026-08-13T10:00:00.000Z",
    updated_at: "2026-08-13T10:05:00.000Z",
    status: "finished",
    outcome: "ai_win",
    winner: 1,
    move_count: 42,
    undo_count: 0,
    rev: 21,
    duration_ms: 60_000,
    nick: "ada",
    schema_version: 1,
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
    webgpu_ok: 1,
    country: "UY",
    ...over,
  };
}

const ORIGIN = "https://adamantivm.github.io";

function env(over: Partial<Env> = {}): Env {
  return { DB: fakeDb().DB, ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`, ...over };
}

function body(over: Record<string, unknown> = {}) {
  return JSON.stringify({
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
}

function post(payload: string, headers: Record<string, string> = {}): Request {
  return new Request("https://stats.example/v1/games", {
    method: "POST",
    // text/plain keeps the per-move write a CORS simple request, so this is
    // what the browser actually sends.
    headers: { origin: ORIGIN, "content-type": "text/plain;charset=UTF-8", ...headers },
    body: payload,
  });
}

describe("worker", () => {
  it("answers health checks", async () => {
    const res = await worker.fetch(new Request("https://stats.example/v1/health"), env());
    expect(res.status).toBe(200);
  });

  it("404s unknown routes", async () => {
    const res = await worker.fetch(new Request("https://stats.example/nope"), env());
    expect(res.status).toBe(404);
  });

  it("accepts a record and writes it once", async () => {
    const db = fakeDb();
    const res = await worker.fetch(
      post(body(), { "cf-connecting-ip": "203.0.113.7", "user-agent": "TestBrowser/1.0" }),
      env({ DB: db.DB }),
    );
    expect(res.status).toBe(202);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].sql).toContain("ON CONFLICT(game_id)");
    // The request metadata is taken from headers, and lands in the last slots.
    expect(db.calls[0].params.slice(-3)).toEqual(["203.0.113.7", "TestBrowser/1.0", null]);
  });

  it("echoes CORS headers for an allowed origin and refuses others", async () => {
    const ok = await worker.fetch(post(body()), env());
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);

    const db = fakeDb();
    const bad = await worker.fetch(post(body(), { origin: "https://evil.example" }), env({ DB: db.DB }));
    expect(bad.status).toBe(403);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it("handles preflight", async () => {
    const req = new Request("https://stats.example/v1/games", {
      method: "OPTIONS",
      headers: { origin: ORIGIN },
    });
    const res = await worker.fetch(req, env());
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("rejects an oversized body before parsing it", async () => {
    const db = fakeDb();
    const res = await worker.fetch(post("x".repeat(70_000)), env({ DB: db.DB }));
    expect(res.status).toBe(413);
    expect(db.calls).toHaveLength(0);
  });

  it("rejects malformed JSON and invalid records", async () => {
    expect((await worker.fetch(post("not json"), env())).status).toBe(400);
    const res = await worker.fetch(post(body({ moves: [99999] })), env());
    expect(res.status).toBe(400);
  });

  it("rate limits by IP", async () => {
    const db = fakeDb();
    const res = await worker.fetch(
      post(body(), { "cf-connecting-ip": "203.0.113.7" }),
      env({ DB: db.DB, RATE_LIMIT: { limit: async () => ({ success: false }) } }),
    );
    expect(res.status).toBe(429);
    expect(db.calls).toHaveLength(0);
  });

  it("reports a write failure without throwing", async () => {
    const res = await worker.fetch(post(body()), env({ DB: fakeDb(true).DB }));
    expect(res.status).toBe(500);
  });
});

/** GET /v1/games and GET /v1/games/{id}: what the stats page reads. */
describe("reads", () => {
  function get(path: string, headers: Record<string, string> = {}): Request {
    return new Request(`https://stats.example${path}`, { headers: { origin: ORIGIN, ...headers } });
  }

  it("lists games newest first, without the move lists", async () => {
    const db = fakeDb(false, [row(), row({ game_id: "game-2" })]);
    const res = await worker.fetch(get("/v1/games"), env({ DB: db.DB }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("cache-control")).toContain("max-age");
    const payload = (await res.json()) as { games: Record<string, unknown>[]; next_cursor: null };
    expect(payload.games.map((g) => g.game_id)).toEqual(["game-1", "game-2"]);
    // SQLite's 1 comes back as a boolean, and nothing server-side leaks out.
    expect(payload.games[0].webgpu_ok).toBe(true);
    expect(payload.games[0]).not.toHaveProperty("ip");
    expect(payload.games[0]).not.toHaveProperty("moves");
    expect(db.calls[0].sql).toContain("ORDER BY started_at DESC, game_id DESC");
  });

  it("returns a cursor only when the page was full", async () => {
    const db = fakeDb(false, [row(), row({ game_id: "game-2" })]);
    const full = await worker.fetch(get("/v1/games?limit=2"), env({ DB: db.DB }));
    const short = await worker.fetch(get("/v1/games?limit=3"), env({ DB: db.DB }));
    expect(((await full.json()) as { next_cursor: string }).next_cursor).toBe(
      "2026-08-13T10:00:00.000Z|game-2",
    );
    expect(((await short.json()) as { next_cursor: null }).next_cursor).toBeNull();
  });

  it("rejects a limit or cursor it cannot use", async () => {
    for (const query of ["?limit=0", "?limit=5000", "?cursor=nope", "?status=bogus"]) {
      const res = await worker.fetch(get(`/v1/games${query}`), env());
      expect(res.status, query).toBe(400);
    }
  });

  it("returns one game with its moves, and 404s an unknown id", async () => {
    const db = fakeDb(false, [{ ...row(), moves: "[12,40]", action_log: '[{"m":12},{"m":40}]' }]);
    const res = await worker.fetch(get("/v1/games/game-1"), env({ DB: db.DB }));
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { game: { moves: number[]; action_log: unknown[] } };
    expect(payload.game.moves).toEqual([12, 40]);
    expect(payload.game.action_log).toEqual([{ m: 12 }, { m: 40 }]);
    expect(db.calls[0].params).toEqual(["game-1"]);

    const missing = await worker.fetch(get("/v1/games/nope"), env({ DB: fakeDb().DB }));
    expect(missing.status).toBe(404);
  });

  it("never queries for a game id we could not have issued", async () => {
    // Ids are crypto.randomUUID(); anything else is a probe, and is answered
    // by the router rather than by the database.
    const db = fakeDb();
    for (const path of ["/v1/games/a.b", "/v1/games/x/y", `/v1/games/${"a".repeat(65)}`]) {
      const res = await worker.fetch(get(path), env({ DB: db.DB }));
      expect(res.status, path).toBe(404);
    }
    expect(db.calls).toHaveLength(0);
  });

  it("refuses a read from a disallowed origin", async () => {
    const db = fakeDb();
    const res = await worker.fetch(get("/v1/games", { origin: "https://evil.example" }), env({ DB: db.DB }));
    expect(res.status).toBe(403);
    expect(db.calls).toHaveLength(0);
  });

  it("rate limits reads on the same budget as writes", async () => {
    const db = fakeDb();
    const res = await worker.fetch(
      get("/v1/games"),
      env({ DB: db.DB, RATE_LIMIT: { limit: async () => ({ success: false }) } }),
    );
    expect(res.status).toBe(429);
    expect(db.calls).toHaveLength(0);
  });

  it("reports a read failure without throwing", async () => {
    expect((await worker.fetch(get("/v1/games"), env({ DB: fakeDb(true).DB }))).status).toBe(500);
    expect((await worker.fetch(get("/v1/games/game-1"), env({ DB: fakeDb(true).DB }))).status).toBe(500);
  });
});
