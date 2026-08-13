import { describe, expect, it } from "vitest";
import worker, { type Env } from "./index";

interface Captured {
  sql: string;
  params: unknown[];
}

/** A D1 stand-in that records what it was asked to run. */
function fakeDb(fail = false) {
  const calls: Captured[] = [];
  const DB = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              if (fail) throw new Error("d1 is down");
              calls.push({ sql, params });
              return {};
            },
          };
        },
      };
    },
  };
  return { DB: DB as unknown as Env["DB"], calls };
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
