# Difficulty presets on the setup screen

## Problem

The setup screen exposes the AI's search parameters raw: three sliders labelled
`MCTS sims`, `c_puct` and `leaf parallelism`. Two of them mean nothing to a
player, and the third only means something once you know what a simulation is.
Someone who wants an easier game has to guess which slider to move and how far.

Replace them with four named levels, and keep the sliders behind a disclosure
for the people who came for them.

## Design

### The control

The `AI search` fieldset becomes a `Difficulty` segmented row, styled like the
`You play First/Second` control already on the screen, with `flex-wrap` so four
labels survive a 360px viewport. Below it, a one-line summary of the selected
level; below that, a collapsed `<details>` twistie holding today's sliders
unchanged.

```
Difficulty
┌─────────┬──────┬────────┬──────────┐
│ Easiest │ Easy │ Normal │Difficult │      Normal preselected
└─────────┴──────┴────────┴──────────┘
1000 sims · a solid opponent
▸ Advanced
```

A native `<details>` gives the twistie and its keyboard behaviour for free.

### The presets

Levels scale from the selected model's own defaults, so `Normal` is always what
that model ships with and a model added later needs no new configuration. `D` is
the model's `mcts_n`, `C` its `mcts_c_puct`.

|           | sims                | c_puct | 9×9 (D=1000) | 5×5 (D=200) |
| --------- | ------------------- | ------ | ------------ | ----------- |
| Easiest   | slider minimum (16) | 2.5    | 16           | 16          |
| Easy      | D/4                 | 1.8    | 248          | 48          |
| Normal    | D                   | C      | 1000         | 200         |
| Difficult | 2×D, capped at 2000 | C      | 2000         | 400         |

Computed sim counts are rounded down onto the sims slider's grid (see "The
slider grid" below), which is why `D/4` of 1000 shows as 248 rather than 250.
Both bundled models' defaults already sit on that grid, so `Normal` is the
model's number untouched.

Sims carry the strength. `c_puct` only loosens at the weak end — a high value
spreads the same few simulations over more candidates, so the visit-count
argmax gets noisier — and never drops below the tuned default, so `Difficult`
plays the way the model was tuned to play, only longer.

`leaf_parallelism` and `virtual_loss` always stay at the model's defaults. They
are speed and hardware knobs, not strength knobs.

### Custom

Opening the twistie changes nothing: it reveals the sliders showing the current
level's values, still highlighted as that level. The first slider edit clears
the highlight; the summary line reads `Custom — 640 sims, c_puct 1.4`. Clicking
any level overwrites the sliders and highlights again.

Switching model re-applies the current level against the new model's defaults.
If the state was Custom it falls back to Normal — hand-tuned numbers for one
board size do not transfer to another. This matches the existing rule that
picking a model replaces the parameters rather than keeping them.

### The slider grid

The sims slider is `min=16 step=16`, so 1000 is not on its grid: a range input
rounds the thumb to the nearest valid step while the label prints the real
value. Changing `step` to 8 puts every value in the table above, and both
bundled models' defaults, exactly on the grid.

### Mid-game

The control rail line becomes `Normal · 1000 sims · c_puct 1.4 · leaf 8`, so
the level stays visible during play rather than only at setup.

## Code

### New module: `frontend/src/lib/difficulty.ts`

Pure, no Svelte, so it tests under the existing vitest node setup the way
`models.ts` and `aggregate.ts` do.

```ts
export type Preset = "easiest" | "easy" | "normal" | "difficult";
export type Difficulty = Preset | "custom";
export type SearchParams = {
  mctsN: number; cPuct: number; leafParallelism: number; virtualLoss: number;
};

export const PRESETS: readonly Preset[];            // display order
export const PRESET_LABEL: Record<Preset, string>;  // "Easiest" …
export const PRESET_BLURB: Record<Preset, string>;  // "a solid opponent" …
export function presetParams(d: ModelDefaults, p: Preset): SearchParams;
```

`presetParams` is the only place the table lives.

`SetupScreen.svelte` and `ControlRail.svelte` drop their duplicated local
`type Params` and import `SearchParams` from here. The copies in `aiClient.ts`
and `ai.worker.ts` stay: those two are the postMessage contract, not UI state.

### `App.svelte`

Gains `let difficulty = $state<Difficulty>("normal")`. Three transitions, all in
one place:

- `onpreset` sets both `difficulty` and `params`
- `onparams` (an advanced slider moved) sets `difficulty = "custom"`
- `selectModel` re-applies the current level against the new model's defaults,
  falling back to Normal when the state was Custom

`params` remains the single source of truth for what the engine receives.
`difficulty` is only a label over it.

### Recording the level

`GameMeta` gains `preset: Difficulty`, sent as `preset` in the payload.

- **`schema.sql`**: `preset TEXT NOT NULL DEFAULT 'unknown'` beside `mcts_n`,
  plus the matching `ALTER TABLE` line in the README's "Changing the schema"
  section — exactly how `nick` was added.
- **`record.ts`**: a `parsePreset` following the `parseNick` precedent. Missing
  or null becomes `'unknown'`; a non-string or an unrecognised string throws.
  Tolerant of absence specifically because a cached older frontend can still be
  posting after the worker deploys; not tolerant of garbage.
- **`sql.ts`**: column in the upsert, its bind, the read row type and select.
- **`statsApi.ts`, `GameList.svelte`, `Replay.svelte`**: a `difficulty` column
  before `sims`, and a `difficulty` row in the replay detail. Pre-existing rows
  read `unknown` and render as `—`.

Aggregation is untouched: the summary table keeps grouping by model, sims and
c_puct.

### Compatibility

`schema_version` stays 1. It is checked with strict equality, so bumping it
would 400 every cached frontend still in the wild. Adding `nick` did not bump
it either; a defaulted column is not a breaking change to the contract.

- **New frontend against old worker**: fine. `validate()` reads named keys off
  the body and never rejects unknown ones, so the extra `preset` is ignored and
  the game records without it.
- **Old frontend against new worker**: fine. `parsePreset(undefined)` yields
  `'unknown'`, which the stats page already has to render for every
  pre-existing row.

So the ordering constraint is the migration, not the frontend: the new worker
writes a column that must already exist in D1, or every upsert 500s.

1. `wrangler d1 execute --remote` for the `ALTER TABLE`
2. deploy the worker
3. deploy the frontend

Steps 2 and 3 are order-independent once step 1 has run. Both are also
fire-and-forget on the client, so a failed write costs a record, never a game.

Steps 1 and 2 are manual and outside this repo's CI; the PR body states them.

## Testing

Unit tests in the existing pure-module style. There is no component testing
library in this repo, so component behaviour is verified in the browser instead.

- `difficulty.test.ts` — Normal reproduces each bundled model's defaults
  verbatim; Easiest is the slider minimum; Easy and Difficult scale off `D`;
  Difficult clamps at 2000; every produced sim count lands on the slider's
  `16 + 8k` grid; `leafParallelism` and `virtualLoss` are never touched.
- `record.test.ts` — a valid preset round-trips, a missing one becomes
  `unknown`, an unrecognised string is rejected.
- `sql.test.ts` — the upsert writes and reads back `preset` against the
  in-memory schema.
- `stats.test.ts` — the payload carries `preset`.

### Browser verification

After `svelte-check`, vitest and `check:build` pass, against the built site via
`scripts/serve-frontend.sh --build` — never the dev server, which does not work
in this repo.

- Desktop and a phone viewport, with the viewport confirmed by
  `playwright-cli eval` before any screenshot is called mobile.
- The segmented row wraps rather than overflowing at 360px.
- The twistie opens with the selected level's values intact and the level still
  highlighted.
- Dragging a slider flips the label to Custom.
- `playwright-cli console error` on both viewports.

Before and after screenshots from the same viewport and page state, committed
under `docs/superpowers/results/images/difficulty-presets/` and linked from the
PR by raw URL pinned to the commit that added them.

## Commits

Per AGENTS.md, functional changes split by concern — the difficulty module and
setup screen, then the stats plumbing — with formatting and lint in their own
commit afterwards.

## Out of scope

- Grouping or filtering the stats page by difficulty.
- Varying `leaf_parallelism` or `virtual_loss` by level.
- Any change to the search itself.
