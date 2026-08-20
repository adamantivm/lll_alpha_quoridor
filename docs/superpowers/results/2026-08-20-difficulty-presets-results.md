# Difficulty presets on the setup screen

## Why

The setup screen used to hand players three raw MCTS sliders — `MCTS sims`,
`c_puct` and `leaf parallelism` — and asked them to pick numbers before a game
could start. Two of those three mean nothing without knowing how the search
works, and the third only means something once you know what a simulation is.
Someone who wanted an easier game had no way to know which slider to move or
how far. This change replaces the sliders with four named levels — Easiest,
Easy, Normal, Difficult — chosen at setup and shown on the control rail during
play, and keeps the sliders around for people who actually want them, behind
a collapsed `Advanced` disclosure.

## The presets

Each level is computed from the selected model's own defaults rather than a
fixed number, so `Normal` is always whatever that model ships with and a
model added later needs no extra tuning. `D` is the model's `mcts_n`, `C` its
`mcts_c_puct`:

| Level | sims | c_puct | 9×9 (D=1000) | 5×5 (D=200) |
| --- | --- | --- | --- | --- |
| Easiest | slider minimum (16) | 2.5 | 16 | 16 |
| Easy | D/4, rounded down onto the grid | 1.8 | 248 | 48 |
| Normal | D, verbatim | the model's own c_puct | 1000 | 200 |
| Difficult | 2×D, capped at 2000 | the model's own c_puct | 2000 | 400 |

Sims carry the strength; `c_puct` only loosens at the weak end and never
drops below the model's tuned value, so `Difficult` plays the way the model
was tuned to play, just for longer. The sims slider's grid is `16 + 8k`, which
is why `D/4` of 1000 lands on 248 rather than 250 — both bundled models'
defaults already sit on that grid, so `Normal` reproduces them exactly.
`leaf_parallelism` and `virtual_loss` are left at the model's defaults at
every level; they're speed and hardware knobs, not strength knobs.

Opening `Advanced` changes nothing by itself — it's a plain HTML disclosure
with no binding to the app state, so it just reveals the current level's
values, still highlighted as that level. The first slider edit clears the
highlight and switches the label to `Custom — <n> sims, c_puct <c>`; clicking
any level afterwards overwrites the sliders and re-highlights. Switching
model re-applies the current level against the new model's defaults, except
that a Custom state falls back to Normal, since hand-tuned numbers for one
board size don't transfer to another.

## Verification

svelte-check, both test suites, the build and the browser pass were all run
against the finished branch, in that order:

- `npm --prefix frontend exec svelte-check -- --threshold error` — `0 ERRORS`
  (one pre-existing warning in `Board.svelte`, untouched by this change).
- `npm --prefix frontend run test` — 123 tests pass across 12 files.
- `npm --prefix stats-worker run test` — 59 tests pass across 3 files.
- `npm --prefix stats-worker run typecheck` — clean, no output.
- `npm --prefix frontend run build` — succeeds (`✓ built in 768ms`).
- `npm --prefix frontend run check:build` — `check:build OK (2 model(s)
  bundled)`.

Only once all of those were green did a browser get pointed at the built
site (`scripts/serve-frontend.sh --build`, never the dev server, which
doesn't work in this repo). On desktop, the default state was
`["Easiest","Easy","Normal*","Difficult"]` with `details.advanced.open ===
false`. Opening the disclosure left `Normal` selected with the sims value
still `1000`. Editing a slider produced `{sel:false, hint:"Custom — 640
sims, c_puct 1.4."}`. Clicking `Easiest` afterwards produced `{sel:"Easiest",
sims:16}`, confirming the slider snaps to the grid on a preset click. At the
360×732, DPR 3 mobile viewport, `document.documentElement.scrollWidth (360)
<= innerWidth (360)` — the segmented row wraps to two lines instead of
overflowing. No console errors were reported on either viewport.

### Screenshots

Before and after, same page state (no nickname, First/P1, default 9×9
model), same viewport, so they compare directly. All five are pinned to
commit `4915b097397feefcb6d7044995499bbbe12afc1a` — its tree holds all five
blobs, which is what makes the URLs resolve — though only the three `-after`
and `-advanced` shots were actually added in that commit; the two `-before`
shots were added earlier, in `2958c6107511a9d2ee83cc4793a8235229bd4010`:

Desktop:
| Before | After |
| --- | --- |
| ![before](https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/4915b097397feefcb6d7044995499bbbe12afc1a/docs/superpowers/results/images/difficulty-presets/setup-desktop-before.png) | ![after](https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/4915b097397feefcb6d7044995499bbbe12afc1a/docs/superpowers/results/images/difficulty-presets/setup-desktop-after.png) |

Mobile (360×732):
| Before | After | Advanced open |
| --- | --- | --- |
| ![before](https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/4915b097397feefcb6d7044995499bbbe12afc1a/docs/superpowers/results/images/difficulty-presets/setup-mobile-before.png) | ![after](https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/4915b097397feefcb6d7044995499bbbe12afc1a/docs/superpowers/results/images/difficulty-presets/setup-mobile-after.png) | ![advanced](https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/4915b097397feefcb6d7044995499bbbe12afc1a/docs/superpowers/results/images/difficulty-presets/setup-mobile-advanced.png) |

The before shots show the pre-change layout: an always-visible "AI search"
fieldset with the three sliders directly in it, no Difficulty row, no
disclosure. The after shots show the segmented Difficulty row, the one-line
hint, and the collapsed twistie; on mobile the row wraps to two lines
(Easiest/Easy/Normal, then Difficult full-width) rather than clipping or
overflowing, and the Advanced-open shot shows the same three sliders still
there, unchanged, once a player asks for them.

## Deploying this

The stats worker now writes a `preset` column that has to exist in D1
*before* the new worker code runs, or every upsert will 500. **These steps
are manual, are not part of this repo's CI, and must happen in this order:**

1. `npx wrangler d1 execute quoridor-stats --remote --command "ALTER TABLE game ADD COLUMN preset TEXT NOT NULL DEFAULT 'unknown'"`
2. `npm --prefix stats-worker run deploy`
3. the frontend deploys from `main` via Pages

Steps 2 and 3 are order-independent once step 1 has run — the migration is
the only hard ordering constraint.

### Compatibility

A new frontend talking to the old (not-yet-deployed) worker records fine:
`validate()` only reads named keys off the body and never rejects unknown
ones, so the extra `preset` field is simply ignored. An old, cached frontend
talking to the new worker also records fine: `parsePreset(undefined)` yields
`'unknown'`, which the stats page already renders as `—` for the rows that
predate this feature entirely. `schema_version` deliberately stays at `1` —
it's checked with strict equality on the worker side, so bumping it would
reject every browser tab that hasn't reloaded yet. Adding a defaulted column
is not a breaking change to that contract; adding `nick` earlier didn't bump
it either.

## Commits

No separate formatting/lint commit exists for this change. AGENTS.md asks
for functional and formatting changes to be split into separate commits, but
this repo configures no formatter for TypeScript or Svelte, and no Rust
files were touched, so there was nothing to split out.

## Known minor points

- `GameSetup.preset` is typed optional (`preset?: Difficulty`), with
  `session.ts` falling back to `"normal"` if it's absent. That's not a bug
  today — the one call site in `App.svelte` always passes it — but a future
  caller could omit it and silently get `"normal"` instead of a type error.
- The committed screenshots run 68–114KB rather than the ~40KB AGENTS.md
  cites as a target for a mobile viewport shot. All five images, including
  the `-before` shots, were added by this branch (`2958c61` and `4915b09`)
  — there is no pre-existing `setup-*-before.png` to compare against. The
  repo's actual pre-existing baseline,
  `docs/superpowers/results/images/browser-verification/`, runs 33–55KB,
  right at the ~40KB AGENTS.md cites, so this is a real gap between the
  stated target and what `playwright-cli screenshot --full-page` produces
  for this setup screen, not a pre-existing one.
