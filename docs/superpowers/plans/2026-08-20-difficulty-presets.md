# Difficulty Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the setup screen's three raw MCTS sliders with four named difficulty levels, keeping the sliders behind an "Advanced" disclosure, and record which level each game was played at.

**Architecture:** One pure module (`frontend/src/lib/difficulty.ts`) owns the preset table and the label helpers; `App.svelte` holds a `difficulty` label alongside the existing `params` state, which stays the single source of truth for what the engine receives. The level travels with the game record through the existing stats pipeline into a new, defaulted `preset` column.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vite, vitest (node environment — there is no component testing library, so component behaviour is verified in a real browser), Cloudflare Worker + D1 SQLite for stats.

**Spec:** `docs/superpowers/specs/2026-08-20-difficulty-presets-design.md`

## Global Constraints

- Branch is `vibe/difficulty-presets`, cut from `main` (already created; the spec commit is on it). Never commit to `main`.
- Commit messages start with `vibe: `, imperative mood, subject ≤ 50 chars after the prefix, body wrapped at 72 explaining **why**. Do not enumerate changed files.
- AGENTS.md requires functional and formatting/lint commits to be separate. **There is no formatter configured for TypeScript or Svelte in this repo** (no prettier, no eslint) and no Rust files are touched, so no formatting commit is produced. Say so in the results file rather than silently omitting it.
- `schema_version` stays `1`. Do not bump it.
- Preset sims grid: valid sim counts are `16 + 8k`, i.e. `MIN_SIMS = 16`, `SIMS_STEP = 8`, `MAX_SIMS = 2000`.
- Preset table, where `D` = model's `mcts_n` and `C` = model's `mcts_c_puct`:
  | level | sims | c_puct |
  | --- | --- | --- |
  | easiest | `MIN_SIMS` (16) | 2.5 |
  | easy | `D/4` rounded down onto the grid | 1.8 |
  | normal | `D` verbatim | `C` |
  | difficult | `2×D` rounded down onto the grid, capped at 2000 | `C` |
- `leaf_parallelism` and `virtual_loss` always come from the model's defaults, at every level.
- Verification commands (from the repo root):
  - `npm --prefix frontend exec svelte-check -- --threshold error`
  - `npm --prefix frontend run test`
  - `npm --prefix frontend run build`
  - `npm --prefix frontend run check:build`
  - `npm --prefix stats-worker run typecheck`
  - `npm --prefix stats-worker run test`
- Browser checks run against the built site only — `npm --prefix frontend run dev` does not work in this repo. Use `scripts/serve-frontend.sh --build` and follow `.claude/skills/playwright-cli/SKILL.md`.

---

## File Structure

**Created:**
- `frontend/src/lib/difficulty.ts` — the preset table, the sims grid, and label helpers. Pure; no Svelte imports.
- `frontend/src/lib/difficulty.test.ts` — its tests.
- `docs/superpowers/results/2026-08-20-difficulty-presets-results.md` — PR body.
- `docs/superpowers/results/images/difficulty-presets/*.png` — before/after screenshots.

**Modified:**
- `frontend/src/lib/SetupScreen.svelte` — segmented level row + `<details>` around the existing sliders.
- `frontend/src/App.svelte:14-33,95-105,121-127` — `difficulty` state and its three transitions.
- `frontend/src/lib/ControlRail.svelte:4-14,51` — level in the mid-game readout.
- `frontend/src/lib/stats.ts:44-55,205-224` — `preset` in `GameMeta` and the payload.
- `frontend/src/lib/stats.test.ts` — payload assertion.
- `frontend/src/lib/statsApi.ts:25-49` — `preset` on the read type.
- `frontend/src/lib/GameList.svelte:36-70` — `level` column.
- `frontend/src/lib/Replay.svelte:121-126` — `level` row.
- `stats-worker/schema.sql:33` — the column.
- `stats-worker/README.md` — the `ALTER TABLE` migration line.
- `stats-worker/src/record.ts:17,51,215` — `parsePreset` and the record field.
- `stats-worker/src/sql.ts:18-27,60-92,127-152,160-186,291-318` — upsert, binds, read columns, row mapping.
- `stats-worker/src/record.test.ts`, `stats-worker/src/sql.test.ts` — coverage for the above.

---

## Task 1: Capture "before" screenshots

These must be taken **before any code changes**, from the current build. Once the setup screen changes, the old state is gone.

**Files:**
- Create: `docs/superpowers/results/images/difficulty-presets/setup-desktop-before.png`
- Create: `docs/superpowers/results/images/difficulty-presets/setup-mobile-before.png`

- [ ] **Step 1: Build and serve the current site**

```bash
scripts/serve-frontend.sh --build
```

Runs `wasm-pack` then `vite build`, and serves `frontend/dist` under `http://localhost:8099/lll_alpha_quoridor/`. It stays in the foreground — run it in the background and leave it running for the whole task.

- [ ] **Step 2: Screenshot the desktop setup screen**

```bash
playwright-cli open http://localhost:8099/lll_alpha_quoridor/
playwright-cli screenshot --full-page \
  --filename=docs/superpowers/results/images/difficulty-presets/setup-desktop-before.png
ls -l docs/superpowers/results/images/difficulty-presets/
```

If `--filename` puts the file in the session directory instead, it will be under `.playwright-cli/` — copy it to the path above. Confirm with `ls` before moving on; do not assume it landed.

- [ ] **Step 3: Screenshot the phone viewport**

```bash
playwright-cli close
playwright-cli open --mobile http://localhost:8099/lll_alpha_quoridor/
playwright-cli eval "({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })"
```

Expected: `{ w: 360, h: 732, dpr: 3 }`. If it prints 1280×720 the flag was ignored — stop and fix it, do not screenshot a desktop viewport and call it mobile.

```bash
playwright-cli screenshot --full-page \
  --filename=docs/superpowers/results/images/difficulty-presets/setup-mobile-before.png
playwright-cli close
```

- [ ] **Step 4: Look at both images**

Read both PNG files. Confirm each shows the setup card with the `AI search` fieldset and its three sliders. A screenshot you have not opened cannot be cited.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/results/images/difficulty-presets/
git commit -m "vibe: capture the setup screen before presets

The AI search sliders are about to be replaced, so a reviewer needs the
old screen to compare against. Desktop and 360px phone viewport, both
of the setup card as a first-time visitor sees it."
```

---

## Task 2: The difficulty module

**Files:**
- Create: `frontend/src/lib/difficulty.ts`
- Test: `frontend/src/lib/difficulty.test.ts`

**Interfaces:**
- Consumes: `ModelDefaults` from `frontend/src/lib/models.ts` — `{ mcts_n: number; mcts_c_puct: number; leaf_parallelism: number; virtual_loss: number }`.
- Produces:
  - `type Preset = "easiest" | "easy" | "normal" | "difficult"`
  - `type Difficulty = Preset | "custom"`
  - `type SearchParams = { mctsN: number; cPuct: number; leafParallelism: number; virtualLoss: number }`
  - `const PRESETS: readonly Preset[]`, `const PRESET_LABEL: Record<Preset, string>`, `const PRESET_BLURB: Record<Preset, string>`
  - `const MIN_SIMS: 16`, `const MAX_SIMS: 2000`, `const SIMS_STEP: 8`
  - `function presetParams(d: ModelDefaults, p: Preset): SearchParams`
  - `function presetLabel(p: string): string`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/difficulty.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm --prefix frontend run test -- difficulty
```

Expected: FAIL — cannot resolve `./difficulty`.

- [ ] **Step 3: Write the module**

Create `frontend/src/lib/difficulty.ts`:

```ts
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
  const clamped = Math.min(MAX_SIMS, Math.max(MIN_SIMS, Math.round(n)));
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm --prefix frontend run test -- difficulty
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/difficulty.ts frontend/src/lib/difficulty.test.ts
git commit -m "vibe: add difficulty presets for the AI search

Four named levels scaled from each model's own defaults, so Normal is
whatever the model shipped with and a model added later needs no extra
configuration. Sims carry the strength; c_puct only loosens at the weak
end, and the batching knobs are left alone because they trade speed, not
playing strength."
```

---

## Task 3: The setup screen and its wiring

**Files:**
- Modify: `frontend/src/lib/SetupScreen.svelte`
- Modify: `frontend/src/App.svelte`
- Modify: `frontend/src/lib/ControlRail.svelte`

**Interfaces:**
- Consumes: `presetParams`, `presetLabel`, `PRESETS`, `PRESET_LABEL`, `PRESET_BLURB`, `MIN_SIMS`, `MAX_SIMS`, `SIMS_STEP`, and the types `Preset`, `Difficulty`, `SearchParams` from Task 2.
- Produces: `App.svelte` holds `difficulty: Difficulty`, which Task 4 reads when starting a game.

There is no component testing library in this repo, so this task's gate is `svelte-check` plus the browser pass in Task 7. Do not invent a testing-library dependency for it.

- [ ] **Step 1: Replace the fieldset in `SetupScreen.svelte`**

In the `<script>` block, delete the local `type Params = …` line and take the type plus the level props from the module:

```ts
import type { ModelEntry } from "./models";
import {
  MAX_SIMS, MIN_SIMS, PRESETS, PRESET_BLURB, PRESET_LABEL, SIMS_STEP,
  type Difficulty, type Preset, type SearchParams,
} from "./difficulty";
import { MAX_NICK_LENGTH } from "./stats";
let { models, selected, params, difficulty, humanPlayer, nick,
      onmodel, onparams, onpreset, onhumanplayer, onnick, onstart, onrules }: {
  models: ModelEntry[];
  selected: ModelEntry;
  params: SearchParams;
  difficulty: Difficulty;
  humanPlayer: number;
  nick: string;
  onmodel: (entry: ModelEntry) => void;
  onparams: (params: SearchParams) => void;
  onpreset: (p: Preset) => void;
  onhumanplayer: (p: number) => void;
  onnick: (nick: string) => void;
  onstart: () => void;
  onrules: () => void;
} = $props();
```

Replace the whole `<fieldset>…</fieldset>` block (currently lines 64-103, from the `<!-- Search settings. -->` comment through `</fieldset>`) with:

```svelte
  <!-- Difficulty. Fixed for the whole game: changing the opponent's strength
       half-way through makes the game, and its record, meaningless. -->
  <div class="who">
    <span class="who-label">Difficulty</span>
    <div class="segmented levels">
      {#each PRESETS as p}
        <label class:sel={difficulty === p}>
          <input type="radio" name="difficulty" checked={difficulty === p}
            onchange={() => onpreset(p)} />
          {PRESET_LABEL[p]}
        </label>
      {/each}
    </div>
    <small class="hint">
      {#if difficulty === "custom"}
        Custom — {params.mctsN} sims, c_puct {params.cPuct}.
      {:else}
        {params.mctsN} sims · {PRESET_BLURB[difficulty]}.
      {/if}
    </small>
  </div>

  <!-- The raw parameters, for people who came for them. Opening this changes
       nothing; editing a slider is what makes the setting Custom. -->
  <details class="advanced">
    <summary>Advanced</summary>
    <fieldset>
      <small class="hint">
        The search parameters behind the levels above. Moving any of them
        switches the difficulty to Custom.
      </small>

      <label>MCTS sims: {params.mctsN}
        <input type="range" min={MIN_SIMS} max={MAX_SIMS} step={SIMS_STEP} value={params.mctsN}
          oninput={(e) => onparams({ ...params, mctsN: +e.currentTarget.value })} />
        <small class="hint">
          How many possible continuations the AI tries before committing to a move.
          More is stronger and slower — this is the main strength dial.
        </small>
      </label>

      <label>c_puct: {params.cPuct}
        <input type="range" min="0.5" max="3" step="0.1" value={params.cPuct}
          oninput={(e) => onparams({ ...params, cPuct: +e.currentTarget.value })} />
        <small class="hint">
          How curious the search is. Low values dig deeper into the moves it
          already likes; high values spread the same effort over more candidates.
          The default is tuned — moving it far either way tends to play worse, not
          faster.
        </small>
      </label>

      <label>leaf parallelism: {params.leafParallelism}
        <input type="range" min="1" max="32" step="1" value={params.leafParallelism}
          oninput={(e) => onparams({ ...params, leafParallelism: +e.currentTarget.value })} />
        <small class="hint">
          How many positions are sent to the network at once. More is faster,
          because your GPU would rather grade a batch than one at a time — but the
          search has to guess about the positions still in flight, so the AI may
          play slightly worse.
        </small>
      </label>
    </fieldset>
  </details>
```

Note the `<legend>` is gone: the `<summary>` names the section now.

In the `<style>` block, allow the four-label row to wrap rather than overflow a phone, and style the disclosure. Add to the existing `.segmented` rule and append the rest:

```css
  .segmented { display: flex; flex-wrap: wrap; gap: 6px; }
  /* Four labels do not fit 360px in one line; each keeps its text on one line
     and the row wraps to two. */
  .levels label { flex: 1 1 auto; white-space: nowrap; }
  .advanced summary {
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    color: #6b5a3f;
  }
  .advanced fieldset { margin-top: 8px; }
```

- [ ] **Step 2: Wire it in `App.svelte`**

Add the import beside the existing ones:

```ts
import { presetParams, type Difficulty, type Preset, type SearchParams } from "./lib/difficulty";
```

Replace the `params` initialiser (currently lines 29-33) with a level plus its parameters:

```ts
  // The level is a label over `params`; `params` is what the engine gets.
  let difficulty = $state<Difficulty>("normal");
  let params = $state(presetParams(initial.defaults, "normal"));
```

Add the two handlers next to `selectModel`, and rewrite `selectModel` itself:

```ts
  function selectPreset(p: Preset) {
    difficulty = p;
    params = presetParams(selected.defaults, p);
  }

  // Hand-editing under Advanced: the numbers are the truth, so the label stops
  // claiming a level it no longer matches.
  function editParams(p: SearchParams) {
    params = p;
    difficulty = "custom";
  }

  // Each model carries its own board size and tuned search defaults, so picking
  // one re-applies the current level against the new model rather than keeping
  // the old numbers. Hand-tuned values cannot transfer to a different board, so
  // Custom falls back to Normal.
  function selectModel(entry: ModelEntry) {
    if (entry.id === selected.id) return;
    selected = entry;
    const p: Preset = difficulty === "custom" ? "normal" : difficulty;
    difficulty = p;
    params = presetParams(entry.defaults, p);
  }
```

Update the `<SetupScreen … />` call to pass the new prop and handlers:

```svelte
  <SetupScreen models={MODELS} {selected} {params} {difficulty} {humanPlayer} {nick}
    onmodel={selectModel}
    onparams={editParams}
    onpreset={selectPreset}
    onhumanplayer={(p) => { humanPlayer = p; }}
    onnick={(n) => { nick = n; }}
    onstart={startGame}
    onrules={() => { showRules = true; }} />
```

And pass the level to the rail, which is the `<ControlRail … />` call around line 147:

```svelte
    <ControlRail {view} {thinking} {progress} {selected} {params} {difficulty} {humanPlayer}
```

(keep that call's existing handler props unchanged.)

- [ ] **Step 3: Show the level mid-game in `ControlRail.svelte`**

Replace the local `type Params = …` line with an import, and add the prop:

```ts
import { presetLabel, type Difficulty, type SearchParams } from "./difficulty";
```

In the `$props()` destructuring add `difficulty` to the list and `difficulty: Difficulty;` to the type, and change `params: Params;` to `params: SearchParams;`.

Change the readout line (currently line 51) to lead with the level:

```svelte
    <div>{presetLabel(difficulty)} · {params.mctsN} sims · c_puct {params.cPuct} · leaf {params.leafParallelism}</div>
```

- [ ] **Step 4: Type-check and test**

```bash
npm --prefix frontend exec svelte-check -- --threshold error
npm --prefix frontend run test
```

Expected: svelte-check reports 0 errors; all tests pass. A missing prop on either component surfaces here — fix it before committing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/SetupScreen.svelte frontend/src/App.svelte frontend/src/lib/ControlRail.svelte
git commit -m "vibe: pick a difficulty instead of raw sliders

The setup screen asked for MCTS sims, c_puct and leaf parallelism before
anyone could start a game. Two of those mean nothing without knowing how
the search works, so wanting an easier opponent meant guessing which
slider to move. The sliders are still there, one disclosure away, and
touching one switches the level to Custom."
```

---

## Task 4: Send the level with the game record

**Files:**
- Modify: `frontend/src/lib/stats.ts`
- Modify: `frontend/src/App.svelte` (the `stats.startGame({…})` call)
- Test: `frontend/src/lib/stats.test.ts`

**Interfaces:**
- Consumes: `Difficulty` from Task 2, `difficulty` state from Task 3.
- Produces: the POST body gains `preset: Difficulty`, which Task 5's worker reads.

- [ ] **Step 1: Write the failing test**

In `frontend/src/lib/stats.test.ts`, add `preset: "normal"` to the `META` fixture at line 16 (it is typed `GameMeta`, so it will not compile without the field once Task 4 step 3 lands). Then add this test inside the `describe("createStatsReporter", …)` block, beside `it("records a game before any move is played", …)`:

```ts
  it("records which difficulty the game was played at", () => {
    const { reporter, sent } = setup();
    reporter.startGame({ ...META, preset: "easy" });
    expect(sent[0]).toMatchObject({ preset: "easy" });
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm --prefix frontend run test -- stats
```

Expected: FAIL — `sent.preset` is `undefined`, and TypeScript rejects `preset` on the meta fixture.

- [ ] **Step 3: Add the field**

In `frontend/src/lib/stats.ts`, import the type at the top:

```ts
import type { Difficulty } from "./difficulty";
```

Add to the `GameMeta` interface, after `humanPlayer`:

```ts
  /** The level the game was played at, or 'custom' if the parameters were
   *  hand-edited. Recorded so win rates can be read per level. */
  preset: Difficulty;
```

Add to the payload object, next to `human_player`:

```ts
      preset: g.meta.preset,
```

In `frontend/src/App.svelte`, add the field to the `stats.startGame({…})` call:

```ts
      maxSteps: selected.max_steps, humanPlayer, preset: difficulty,
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm --prefix frontend run test
npm --prefix frontend exec svelte-check -- --threshold error
```

Expected: PASS, 0 svelte-check errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/stats.ts frontend/src/lib/stats.test.ts frontend/src/App.svelte
git commit -m "vibe: record the difficulty a game was played at

The parameters were already recorded, but a level is what a player
actually chose, and 'custom' is a fact the numbers alone cannot express.
Recording it now means the data exists whenever the stats page wants to
break win rates down by level."
```

---

## Task 5: Accept and store the level in the worker

**Files:**
- Modify: `stats-worker/schema.sql`
- Modify: `stats-worker/README.md`
- Modify: `stats-worker/src/record.ts`
- Modify: `stats-worker/src/sql.ts`
- Test: `stats-worker/src/record.test.ts`, `stats-worker/src/sql.test.ts`

**Interfaces:**
- Consumes: the `preset` field in the POST body from Task 4.
- Produces: `GameRecord.preset: string`, `GameSummary.preset: string`, and a `preset` column, which Task 6 renders.

- [ ] **Step 1: Write the failing tests**

In `stats-worker/src/record.test.ts`, add these inside the `describe("validate", …)` block. `body(over)` (line 5) and `err(over)` (line 35) are the file's existing helpers; the base body deliberately carries no `preset`, which is exactly the older-client case:

```ts
  it("keeps a valid preset", () => {
    const r = validate(body({ preset: "difficult" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.preset).toBe("difficult");
  });

  it("defaults a missing preset, the way an older client sends none", () => {
    const r = validate(body());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.preset).toBe("unknown");
  });

  it("rejects a preset it does not know", () => {
    expect(err({ preset: "impossible" })).toContain("preset");
    expect(err({ preset: 7 })).toContain("preset");
  });
```

In `stats-worker/src/sql.test.ts`, add `preset: "normal",` to the `record()` factory at line 50 — it is typed `GameRecord`, so it will not compile without the field. Then add this test inside the `describe.skipIf(!DatabaseSync)("UPSERT_SQL", …)` block, where `write()` and `read()` are its existing helpers:

```ts
  it("stores the difficulty the game was played at", () => {
    write({ preset: "easiest" });
    expect(read()!.preset).toBe("easiest");
  });
```

And add `preset: "normal",` to the `toMatchObject({…})` in `it("shapes a summary row for the API", …)`, so the read path is covered too.

- [ ] **Step 2: Run them to verify they fail**

```bash
npm --prefix stats-worker run test
```

Expected: FAIL — `preset` is not on the record, and the column does not exist.

- [ ] **Step 3: Add the column**

In `stats-worker/schema.sql`, add after the `human_player` line:

```sql
  preset           TEXT NOT NULL DEFAULT 'unknown',  -- difficulty level, or 'custom'; 'unknown' before levels existed
```

In `stats-worker/README.md`, in the "Changing the schema" section, add below the existing `nick` example:

```bash
npx wrangler d1 execute quoridor-stats --remote --command "ALTER TABLE game ADD COLUMN preset TEXT NOT NULL DEFAULT 'unknown'"
```

- [ ] **Step 4: Validate it in `record.ts`**

Add beside `DEFAULT_NICK`:

```ts
export const DEFAULT_PRESET = "unknown";

/** The levels the setup screen can send, plus the backfill default. */
const PRESETS: readonly string[] = [
  "easiest", "easy", "normal", "difficult", "custom", DEFAULT_PRESET,
];
```

Add the parser beside `parseNick`:

```ts
/**
 * Absence is fine: a cached older frontend posts no preset at all, and its
 * games are still worth recording. Garbage is not -- an unrecognised level
 * would quietly poison any per-level statistic.
 */
export function parsePreset(raw: unknown): string {
  if (raw === undefined || raw === null) return DEFAULT_PRESET;
  if (typeof raw !== "string") throw new Error("preset must be a string or null");
  if (!PRESETS.includes(raw)) throw new Error(`preset must be one of ${PRESETS.join("|")}`);
  return raw;
}
```

Add `preset: string;` to the `GameRecord` interface after `human_player`, and to the returned record in `validate()`, after `human_player`:

```ts
        preset: parsePreset(o.preset),
```

- [ ] **Step 5: Store and read it in `sql.ts`**

In `UPSERT_SQL`, add `preset` to the column list after `human_player`:

```sql
  model_label, model_id, board_size, max_walls, max_steps, human_player, preset,
```

and add one more placeholder — the `VALUES` block must hold 31 `?`, so make it:

```sql
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
)
```

Do **not** add `preset` to the `ON CONFLICT DO UPDATE SET` list: it is fixed when the game starts, like the model and the board size.

In `bindValues`, add after `r.human_player`:

```ts
    r.preset,
```

Add `"preset",` to `SUMMARY_COLUMNS` after `"human_player"`, `preset: string;` to the `GameSummary` interface after `human_player`, and to `rowToSummary` after `human_player`:

```ts
    preset: (row.preset ?? "unknown") as string,
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm --prefix stats-worker run test
npm --prefix stats-worker run typecheck
```

Expected: PASS, 0 type errors. If a bind test fails on argument count, the `?` count in `VALUES` does not match the column list — recount both.

- [ ] **Step 7: Commit**

```bash
git add stats-worker/
git commit -m "vibe: store the difficulty level with each game

A defaulted column, so the migration is additive and every game already
in the table reads 'unknown'. A missing preset is accepted for the same
reason a missing nick was: a cached frontend keeps posting after the
worker deploys, and those games are still worth having.

schema_version stays 1 deliberately -- it is checked for equality, so
bumping it would reject every client that has not reloaded yet."
```

---

## Task 6: Show the level on the stats page

**Files:**
- Modify: `frontend/src/lib/statsApi.ts`
- Modify: `frontend/src/lib/GameList.svelte`
- Modify: `frontend/src/lib/Replay.svelte`

**Interfaces:**
- Consumes: `preset` on the read API from Task 5; `presetLabel` from Task 2.
- Produces: nothing later tasks depend on.

Aggregation is deliberately untouched: `aggregate.ts` and the summary table keep grouping by model, sims and c_puct.

- [ ] **Step 1: Add the field to the read type**

In `frontend/src/lib/statsApi.ts`, add to `GameSummary` after `human_player`, keeping it a mirror of the worker's interface:

```ts
  preset: string;
```

`frontend/src/lib/aggregate.test.ts` builds a full `GameSummary` in its `game()` factory at line 18, so add `preset: "normal",` there as well or it will not compile. `statsApi.test.ts` casts its fixtures with `as GameSummary[]` and needs no change.

- [ ] **Step 2: Add the column to the list**

In `frontend/src/lib/GameList.svelte`, import the helper in the `<script>` block:

```ts
import { presetLabel } from "./difficulty";
```

Add a header cell before the `sims` one:

```svelte
        <th>level</th>
```

and the matching body cell before the `{g.mcts_n}` one:

```svelte
          <td>{presetLabel(g.preset)}</td>
```

- [ ] **Step 3: Add the row to the replay detail**

In `frontend/src/lib/Replay.svelte`, import the helper in the `<script>` block:

```ts
import { presetLabel } from "./difficulty";
```

and add above the `sims` row in the `<dl class="params">`:

```svelte
      <dt>level</dt><dd>{presetLabel(game.preset)}</dd>
```

- [ ] **Step 4: Type-check, test and build**

```bash
npm --prefix frontend exec svelte-check -- --threshold error
npm --prefix frontend run test
npm --prefix frontend run build
npm --prefix frontend run check:build
```

Expected: 0 errors, all tests pass, build succeeds, `check:build` passes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/statsApi.ts frontend/src/lib/GameList.svelte frontend/src/lib/Replay.svelte
git commit -m "vibe: show the difficulty level in the game list

Games recorded before levels existed read as a dash rather than an
invented level."
```

---

## Task 7: Browser verification and "after" screenshots

Runs only once svelte-check, the unit tests, `build` and `check:build` all pass — do not point a browser at a build that does not compile.

**Files:**
- Create: `docs/superpowers/results/images/difficulty-presets/setup-desktop-after.png`
- Create: `docs/superpowers/results/images/difficulty-presets/setup-mobile-after.png`
- Create: `docs/superpowers/results/images/difficulty-presets/setup-mobile-advanced.png`

- [ ] **Step 1: Rebuild and serve**

```bash
scripts/serve-frontend.sh --build
```

Leave it running in the background for the whole task.

- [ ] **Step 2: Check the desktop setup screen**

```bash
playwright-cli open http://localhost:8099/lll_alpha_quoridor/
playwright-cli screenshot --full-page \
  --filename=docs/superpowers/results/images/difficulty-presets/setup-desktop-after.png
playwright-cli console error
```

Expected: the level row with Normal selected, the summary reading `1000 sims · a solid opponent.`, a collapsed `Advanced` twistie, and no console errors.

- [ ] **Step 3: Confirm the state machine in the browser**

```bash
# The level row is four labels, Normal selected, and Advanced starts closed.
playwright-cli eval "Array.from(document.querySelectorAll('.levels label')).map(l => l.textContent.trim() + (l.className.includes('sel') ? '*' : ''))"
playwright-cli eval "document.querySelector('details.advanced').open"
```

Expected: `["Easiest","Easy","Normal*","Difficult"]` and `false`.

```bash
# Opening Advanced changes nothing: still Normal, still 1000 sims.
# `click` takes a snapshot ref or a unique CSS selector -- not a text= locator.
playwright-cli click "details.advanced summary"
playwright-cli eval "({ open: document.querySelector('details.advanced').open, sel: document.querySelector('.levels label.sel').textContent.trim(), sims: document.querySelector('details.advanced label').textContent.trim() })"
```

Expected: `{ open: true, sel: "Normal", sims: "MCTS sims: 1000" }`.

```bash
# Editing a slider is what makes it Custom.
playwright-cli eval "const s = document.querySelector('details.advanced input[type=range]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(s, '640'); s.dispatchEvent(new Event('input', { bubbles: true })); null"
playwright-cli eval "({ sel: !!document.querySelector('.levels label.sel'), hint: document.querySelector('.levels').parentElement.querySelector('.hint').textContent.trim() })"
```

Expected: `sel: false` (no level highlighted) and a hint beginning `Custom — 640 sims`.

```bash
# Clicking a level takes it back. Easiest is the first label in the row.
playwright-cli click ".levels label:nth-child(1)"
playwright-cli eval "({ sel: document.querySelector('.levels label.sel').textContent.trim(), sims: +document.querySelector('details.advanced input[type=range]').value })"
```

Expected: `{ sel: "Easiest", sims: 16 }`. If `sims` comes back as something other than 16, the slider grid is wrong — the value is being snapped by the browser, so fix `SIMS_STEP` rather than the screenshot.

- [ ] **Step 4: Check the phone viewport**

```bash
playwright-cli close
playwright-cli open --mobile http://localhost:8099/lll_alpha_quoridor/
playwright-cli eval "({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })"
```

Expected: `{ w: 360, h: 732, dpr: 3 }`. Anything else means the flag was ignored — stop.

```bash
# Nothing may overflow the viewport, and the four labels must be inside the card.
playwright-cli eval "({ doc: document.documentElement.scrollWidth, win: innerWidth, row: document.querySelector('.levels').getBoundingClientRect().width, labels: Array.from(document.querySelectorAll('.levels label')).map(l => Math.round(l.getBoundingClientRect().right)) })"
playwright-cli screenshot --full-page \
  --filename=docs/superpowers/results/images/difficulty-presets/setup-mobile-after.png
playwright-cli click "details.advanced summary"
playwright-cli screenshot --full-page \
  --filename=docs/superpowers/results/images/difficulty-presets/setup-mobile-advanced.png
playwright-cli console error
playwright-cli close
```

Expected: `doc <= win` (no horizontal overflow), every label's right edge inside the card, and no console errors.

- [ ] **Step 5: Look at every screenshot**

Read all three PNG files, and re-read the two "before" images from Task 1. Confirm the after shots show the level row and that the mobile one wraps rather than clipping. Do not cite an image you have not opened.

- [ ] **Step 6: Commit the screenshots**

```bash
git add docs/superpowers/results/images/difficulty-presets/
git commit -m "vibe: capture the setup screen with presets

Same viewports and page state as the before shots, plus the phone
viewport with Advanced open, since that disclosure is the part a
reviewer cannot check from the desktop image."
```

---

## Task 8: Results file and pull request

**Files:**
- Create: `docs/superpowers/results/2026-08-20-difficulty-presets-results.md`

- [ ] **Step 1: Write the results file**

Cover, in prose:

- What changed and why: four levels replacing three raw sliders; the sliders kept behind Advanced; the level recorded per game.
- The preset table, with the resolved numbers for both bundled models.
- The Custom rule: opening Advanced changes nothing, the first edit does.
- What was verified, with the actual command output: svelte-check, both test suites, build, `check:build`, and the browser checks including the measured values from Task 7 step 3 and step 4.
- Screenshots: before and after, desktop and mobile, linked by raw URL pinned to the commit that added them:
  `https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/<sha>/docs/superpowers/results/images/difficulty-presets/<name>.png`
  Get `<sha>` from `git rev-parse HEAD` after the screenshot commit.
- **Deploy steps, prominently** — these are manual and must happen in this order:
  1. `npx wrangler d1 execute quoridor-stats --remote --command "ALTER TABLE game ADD COLUMN preset TEXT NOT NULL DEFAULT 'unknown'"`
  2. `npm --prefix stats-worker run deploy`
  3. the frontend deploys itself from `main` via Pages
  Steps 2 and 3 are order-independent once step 1 has run; step 1 is not optional, because the new worker writes a column that must already exist.
- Compatibility, stated plainly: a new frontend against the old worker records fine (unknown fields are ignored); an old frontend against the new worker records as `unknown`. `schema_version` stays 1.
- That no formatting/lint commit exists because the repo configures no formatter for TypeScript or Svelte and no Rust files were touched.

- [ ] **Step 2: Commit it**

```bash
git add docs/superpowers/results/2026-08-20-difficulty-presets-results.md
git commit -m "vibe: write up the difficulty presets change"
```

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin vibe/difficulty-presets
gh pr create --base main --title "vibe: pick a difficulty instead of raw MCTS sliders" \
  --body-file docs/superpowers/results/2026-08-20-difficulty-presets-results.md
```

Report the PR URL. Do not merge it.

If `gh` or the push fails for want of credentials or network, stop there and say exactly what remains — never fall back to committing on `main`.
