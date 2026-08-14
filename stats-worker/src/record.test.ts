import { describe, expect, it } from "vitest";
import { DEFAULT_NICK, MAX_NICK_LENGTH, actionSpaceSize, parseNick, validate } from "./record";

/** A minimal valid body; tests override single fields to probe one rule at a time. */
function body(over: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    game_id: "6f1c7b4e-0d2a-4a1f-8f6c-2b9d4e5a1c33",
    rev: 1,
    status: "in_progress",
    outcome: null,
    winner: null,
    moves: [12, 40],
    action_log: [{ m: 12 }, { m: 40 }],
    undo_count: 0,
    duration_ms: 1500,
    client_id: "c8b1a2d3",
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
  };
}

function err(over: Record<string, unknown>): string {
  const r = validate(body(over));
  expect(r.ok, `expected ${JSON.stringify(over)} to be rejected`).toBe(false);
  return r.ok ? "" : r.error;
}

describe("actionSpaceSize", () => {
  // N*N pawn destinations plus a vertical and a horizontal slot per interior
  // intersection -- the layout quoridor-wasm encodes action indices in.
  it("matches the wasm action layout", () => {
    expect(actionSpaceSize(5)).toBe(25 + 2 * 16);
    expect(actionSpaceSize(9)).toBe(81 + 2 * 64);
  });
});

describe("parseNick", () => {
  it("keeps a plain nick", () => {
    expect(parseNick("ada")).toBe("ada");
    expect(parseNick("  ada  ")).toBe("ada");
  });

  // The field is newer than clients that may still be cached, and a blank one
  // is no more informative than none at all.
  it("falls back when there is nothing to store", () => {
    expect(parseNick(undefined)).toBe(DEFAULT_NICK);
    expect(parseNick(null)).toBe(DEFAULT_NICK);
    expect(parseNick("")).toBe(DEFAULT_NICK);
    expect(parseNick("   ")).toBe(DEFAULT_NICK);
    expect(parseNick("\n\t")).toBe(DEFAULT_NICK);
  });

  it("truncates rather than rejecting an over-long nick", () => {
    const long = "x".repeat(MAX_NICK_LENGTH + 50);
    expect(parseNick(long)).toBe("x".repeat(MAX_NICK_LENGTH));
  });

  it("strips control characters so a nick stays one printable line", () => {
    expect(parseNick("a\u0000da\u0007!")).toBe("a da !");
    expect(parseNick("line\nbreak")).toBe("line break");
  });

  it("rejects a non-string nick", () => {
    expect(() => parseNick(42)).toThrow(/nick/);
    expect(() => parseNick({ nick: "ada" })).toThrow(/nick/);
  });
});

describe("validate", () => {
  it("accepts a well-formed record", () => {
    const r = validate(body());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.game_id).toBe("6f1c7b4e-0d2a-4a1f-8f6c-2b9d4e5a1c33");
      expect(r.record.moves).toEqual([12, 40]);
      expect(r.record.action_log).toEqual([{ m: 12 }, { m: 40 }]);
    }
  });

  it("rejects non-objects", () => {
    expect(validate(null).ok).toBe(false);
    expect(validate([1, 2]).ok).toBe(false);
    expect(validate("hi").ok).toBe(false);
  });

  it("rejects an unknown schema version", () => {
    expect(err({ schema_version: 2 })).toContain("schema_version");
  });

  it("rejects action indices outside the board's action space", () => {
    // 209 is legal on 9x9 (space is 209 wide, so 208 is the last index).
    expect(validate(body({ moves: [208] })).ok).toBe(true);
    expect(err({ moves: [209] })).toContain("moves[0]");
    expect(err({ moves: [-1] })).toContain("moves[0]");
    expect(err({ moves: [1.5] })).toContain("moves[0]");
    // The same index is out of range on a smaller board.
    expect(err({ board_size: 5, max_steps: 50, moves: [100] })).toContain("5x5");
  });

  it("rejects a move list longer than the step cap", () => {
    expect(err({ max_steps: 2, moves: [1, 2, 3] })).toContain("max_steps");
  });

  it("accepts takebacks in the action log and rejects malformed entries", () => {
    expect(validate(body({ action_log: [{ m: 12 }, { m: 40 }, { u: 2 }, { m: 17 }] })).ok).toBe(true);
    expect(err({ action_log: [{ u: 0 }] })).toContain("takeback");
    expect(err({ action_log: [{ m: 5000 }] })).toContain("action index");
    expect(err({ action_log: [{ x: 1 }] })).toContain('numeric "m" or "u"');
    expect(err({ action_log: [null] })).toContain("must be an object");
  });

  it("requires an outcome once the game is finished", () => {
    expect(err({ status: "finished", outcome: null })).toContain("outcome");
    expect(validate(body({ status: "finished", outcome: "ai_win", winner: 1 })).ok).toBe(true);
    expect(validate(body({ status: "abandoned" })).ok).toBe(true);
  });

  it("rejects unknown statuses and outcomes", () => {
    expect(err({ status: "paused" })).toContain("status must be");
    expect(err({ outcome: "cat" })).toContain("outcome must be");
  });

  it("rejects an implausible winner", () => {
    expect(err({ winner: 2 })).toContain("winner");
    expect(validate(body({ winner: null })).ok).toBe(true);
  });

  it("bounds the numeric fields", () => {
    expect(err({ rev: 0 })).toContain("rev");
    expect(err({ board_size: 2 })).toContain("board_size");
    expect(err({ duration_ms: -1 })).toContain("duration_ms");
    expect(err({ c_puct: Number.NaN })).toContain("c_puct");
    expect(err({ mcts_n: 0 })).toContain("mcts_n");
  });

  it("requires the identifying strings and caps their length", () => {
    expect(err({ game_id: "" })).toContain("game_id");
    expect(err({ client_id: 42 })).toContain("client_id");
    expect(err({ model_label: "x".repeat(121) })).toContain("model_label");
  });

  it("carries the nick through, defaulting when the client sends none", () => {
    const named = validate(body({ nick: " Ada " }));
    expect(named.ok && named.record.nick).toBe("Ada");
    const anonymous = validate(body({ nick: undefined }));
    expect(anonymous.ok && anonymous.record.nick).toBe(DEFAULT_NICK);
    expect(err({ nick: 42 })).toContain("nick");
  });

  it("treats app_version and webgpu_ok as optional", () => {
    const r = validate(body({ app_version: null, webgpu_ok: null }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.app_version).toBeNull();
      expect(r.record.webgpu_ok).toBeNull();
    }
  });
});
