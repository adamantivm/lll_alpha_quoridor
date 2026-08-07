import { describe, expect, it } from "vitest";
import { buildEntries, joinUrl, parseMeta, pickDefault, type ModelEntry } from "./models";

const raw = {
  label: "5×5, 2 walls (mv1)",
  default: true,
  board_size: 5,
  max_walls: 2,
  max_steps: 50,
  defaults: { mcts_n: 200, mcts_c_puct: 1.4, leaf_parallelism: 8, virtual_loss: 1 },
};

function entry(id: string, over: Partial<ModelEntry> = {}): ModelEntry {
  return { ...parseMeta(id, raw), ...over };
}

describe("parseMeta", () => {
  it("maps a valid meta onto a ModelEntry", () => {
    const e = parseMeta("b5w2-mv1", raw);
    expect(e.id).toBe("b5w2-mv1");
    expect(e.label).toBe("5×5, 2 walls (mv1)");
    expect(e.isDefault).toBe(true);
    expect(e.board_size).toBe(5);
    expect(e.defaults.mcts_n).toBe(200);
  });

  it("defaults isDefault to false when the key is absent", () => {
    const { default: _omit, ...noFlag } = raw;
    expect(parseMeta("x", noFlag).isDefault).toBe(false);
  });

  it("names the model and the field when a field is missing", () => {
    const { max_walls: _omit, ...broken } = raw;
    expect(() => parseMeta("b9w10", broken)).toThrow(/b9w10.*max_walls/);
  });

  it("names the model and the field when a field has the wrong type", () => {
    expect(() => parseMeta("b9w10", { ...raw, board_size: "five" })).toThrow(
      /b9w10.*board_size/,
    );
  });

  it("rejects a missing defaults block", () => {
    const { defaults: _omit, ...broken } = raw;
    expect(() => parseMeta("b9w10", broken)).toThrow(/b9w10.*defaults/);
  });
});

describe("buildEntries", () => {
  it("derives ids from the directory name and sorts by id", () => {
    const entries = buildEntries({
      "../../models/zzz/meta.json": raw,
      "../../models/aaa/meta.json": raw,
    });
    expect(entries.map((e) => e.id)).toEqual(["aaa", "zzz"]);
  });

  it("throws when there are no models at all", () => {
    expect(() => buildEntries({})).toThrow(/no models/i);
  });
});

describe("pickDefault", () => {
  it("prefers the entry flagged default", () => {
    const entries = [entry("aaa"), entry("zzz", { isDefault: false })];
    expect(pickDefault(entries).id).toBe("aaa");
  });

  it("falls back to the last by id when nothing is flagged", () => {
    const entries = [entry("aaa", { isDefault: false }), entry("zzz", { isDefault: false })];
    expect(pickDefault(entries).id).toBe("zzz");
  });

  it("falls back to the last by id when several are flagged", () => {
    const entries = [entry("aaa"), entry("zzz")];
    expect(pickDefault(entries).id).toBe("zzz");
  });
});

describe("joinUrl", () => {
  it("resolves against a subpath base, as a GitHub project page serves", () => {
    expect(joinUrl("http://h/lll_alpha_quoridor/", "models/b5w2-mv1/model.onnx")).toBe(
      "http://h/lll_alpha_quoridor/models/b5w2-mv1/model.onnx",
    );
  });

  it("resolves against a root base", () => {
    expect(joinUrl("http://h/", "ort/")).toBe("http://h/ort/");
  });

  it("does not let a path escape the base", () => {
    expect(joinUrl("http://h/sub/", "models/x/model.onnx")).toContain("/sub/models/");
  });
});
