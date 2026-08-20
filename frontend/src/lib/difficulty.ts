/**
 * Difficulty levels for the setup screen.
 *
 * A level is a label over the search parameters, not a separate setting: the
 * engine only ever sees the parameters. Levels scale from the selected model's
 * own defaults, so "Normal" is whatever that model shipped with and a model
 * added later needs no new configuration here.
 */
import type { ModelDefaults } from "./models";

export type Preset = "easiest" | "easy" | "normal" | "difficult";

/** A level, or the state of having hand-edited the parameters under Advanced. */
export type Difficulty = Preset | "custom";

/** What the engine is actually given. Mirrored in aiClient.ts across postMessage. */
export interface SearchParams {
  mctsN: number;
  cPuct: number;
  leafParallelism: number;
  virtualLoss: number;
}

/** The sims slider's range. Preset sim counts sit on its MIN_SIMS + k*SIMS_STEP
 *  grid, so the slider under Advanced shows exactly the value in force. */
export const MIN_SIMS = 16;
export const MAX_SIMS = 2000;
export const SIMS_STEP = 8;

export const PRESETS: readonly Preset[] = ["easiest", "easy", "normal", "difficult"];

export const PRESET_LABEL: Record<Preset, string> = {
  easiest: "Easiest",
  easy: "Easy",
  normal: "Normal",
  difficult: "Difficult",
};

export const PRESET_BLURB: Record<Preset, string> = {
  easiest: "barely thinks ahead",
  easy: "a light opponent",
  normal: "a solid opponent",
  difficult: "slower, and stronger",
};

/** Round down onto the sims slider's grid, clamped to its range. */
function onGrid(n: number): number {
  const clamped = Math.min(MAX_SIMS, Math.max(MIN_SIMS, n));
  return MIN_SIMS + Math.floor((clamped - MIN_SIMS) / SIMS_STEP) * SIMS_STEP;
}

/**
 * The parameters for one level, given the selected model's defaults.
 *
 * Sims carry the strength. c_puct only loosens at the weak end -- a high value
 * spreads the same few simulations over more candidates, so the visit-count
 * argmax gets noisier -- and never drops below the model's tuned value, so
 * Difficult plays the way the model was tuned to play, only longer.
 * Leaf parallelism and virtual loss are speed knobs and stay where the model
 * put them.
 */
export function presetParams(d: ModelDefaults, p: Preset): SearchParams {
  const batching = { leafParallelism: d.leaf_parallelism, virtualLoss: d.virtual_loss };
  switch (p) {
    case "easiest":
      return { ...batching, mctsN: MIN_SIMS, cPuct: 2.5 };
    case "easy":
      return { ...batching, mctsN: onGrid(d.mcts_n / 4), cPuct: 1.8 };
    case "normal":
      return { ...batching, mctsN: d.mcts_n, cPuct: d.mcts_c_puct };
    case "difficult":
      return { ...batching, mctsN: onGrid(d.mcts_n * 2), cPuct: d.mcts_c_puct };
  }
}

/**
 * Display name for a level. Takes a plain string because it also renders the
 * `preset` field of recorded games, which is 'unknown' for every game played
 * before levels existed.
 */
export function presetLabel(p: string): string {
  if (p === "custom") return "Custom";
  return PRESET_LABEL[p as Preset] ?? "—";
}
