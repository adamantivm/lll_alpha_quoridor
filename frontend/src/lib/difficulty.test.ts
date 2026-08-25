import { describe, expect, it } from "vitest";
import type { ModelDefaults } from "./models";
import {
  MAX_SIMS,
  MIN_SIMS,
  PRESETS,
  SIMS_STEP,
  presetLabel,
  presetParams,
} from "./difficulty";

// The two models bundled with the site, from frontend/models/*/meta.json.
const B9: ModelDefaults = { mcts_n: 1000, mcts_c_puct: 1.4, leaf_parallelism: 8, virtual_loss: 1 };
const B5: ModelDefaults = { mcts_n: 200, mcts_c_puct: 1.4, leaf_parallelism: 8, virtual_loss: 1 };

describe("presetParams", () => {
  it("gives normal the model's own defaults, untouched", () => {
    expect(presetParams(B9, "normal")).toEqual({
      mctsN: 1000, cPuct: 1.4, leafParallelism: 8, virtualLoss: 1,
    });
    expect(presetParams(B5, "normal")).toEqual({
      mctsN: 200, cPuct: 1.4, leafParallelism: 8, virtualLoss: 1,
    });
  });

  it("gives easiest the slider minimum on every model", () => {
    expect(presetParams(B9, "easiest").mctsN).toBe(MIN_SIMS);
    expect(presetParams(B5, "easiest").mctsN).toBe(MIN_SIMS);
  });

  it("scales easy and difficult off the model default", () => {
    expect(presetParams(B9, "easy").mctsN).toBe(248); // 1000/4 = 250, down onto the grid
    expect(presetParams(B9, "difficult").mctsN).toBe(2000);
    expect(presetParams(B5, "easy").mctsN).toBe(48); // 200/4 = 50, down onto the grid
    expect(presetParams(B5, "difficult").mctsN).toBe(400);
  });

  it("caps difficult at the slider maximum", () => {
    const big: ModelDefaults = { ...B9, mcts_n: 1800 };
    expect(presetParams(big, "difficult").mctsN).toBe(MAX_SIMS);
  });

  it("rounds down for fractional inputs like 990/4", () => {
    const m990: ModelDefaults = { ...B9, mcts_n: 990 };
    expect(presetParams(m990, "easy").mctsN).toBe(240); // 990/4 = 247.5, down to 240
  });

  it("keeps every sim count on the slider's grid and in range", () => {
    for (const d of [B9, B5, { ...B9, mcts_n: 999 }, { ...B5, mcts_n: 17 }]) {
      for (const p of PRESETS) {
        const n = presetParams(d, p).mctsN;
        expect(n).toBeGreaterThanOrEqual(MIN_SIMS);
        expect(n).toBeLessThanOrEqual(MAX_SIMS);
        // normal is the model's number verbatim and need not sit on the grid.
        if (p !== "normal") expect((n - MIN_SIMS) % SIMS_STEP).toBe(0);
      }
    }
  });

  it("only loosens c_puct, never tightens it below the model's own", () => {
    expect(presetParams(B9, "easiest").cPuct).toBe(2.5);
    expect(presetParams(B9, "easy").cPuct).toBe(1.8);
    expect(presetParams(B9, "normal").cPuct).toBe(1.4);
    expect(presetParams(B9, "difficult").cPuct).toBe(1.4);
  });

  it("never touches the batching parameters", () => {
    const d: ModelDefaults = { ...B9, leaf_parallelism: 4, virtual_loss: 2 };
    for (const p of PRESETS) {
      expect(presetParams(d, p).leafParallelism).toBe(4);
      expect(presetParams(d, p).virtualLoss).toBe(2);
    }
  });
});

describe("presetLabel", () => {
  it("names the levels and custom", () => {
    expect(presetLabel("normal")).toBe("Normal");
    expect(presetLabel("difficult")).toBe("Difficult");
    expect(presetLabel("custom")).toBe("Custom");
  });

  it("dashes anything it does not recognise, including old records", () => {
    expect(presetLabel("unknown")).toBe("—");
    expect(presetLabel("")).toBe("—");
  });

  // PRESET_LABEL is a plain object; indexing it with an unchecked string
  // would resolve inherited Object.prototype members instead of dashing.
  it("does not resolve Object.prototype members", () => {
    expect(presetLabel("constructor")).toBe("—");
    expect(presetLabel("toString")).toBe("—");
  });
});
