# Stats page: filter by result

## What changed

The stats page's filter row gains a **Result** picker: *any* / *human won* /
*AI won* / *draw*. Selecting one narrows the game list and the per-configuration
summary table the same way the existing pickers do, so "show me only the games
humans won" is now one click instead of reading down the result column.

## Why

Every other axis of the data was already filterable -- player, status, model,
build -- but the one thing the page is about, who won, was not. `outcome` is
already on every summary row the API returns, so this needed no new request and
no new computation.

## How

- `Filters` in [aggregate.ts](frontend/src/lib/aggregate.ts) gains
  `outcome: GameOutcome | null`, defaulting to `null` (any), and
  `applyFilters` gains the matching clause next to the existing ones.
- [StatsApp.svelte](frontend/src/StatsApp.svelte) gains the `<select>`, wired
  exactly like the Status picker beside it.

Only finished games carry an outcome, so choosing a result implicitly restricts
the view to finished games. That is the intended reading of the question and
needs no extra clause.

## Verification

- `npx svelte-check --threshold error` -- 0 errors. (The one warning,
  `a11y_no_noninteractive_tabindex` in `Board.svelte`, is pre-existing and
  untouched by this change.)
- `npm --prefix frontend test` -- 124 passed, including three new assertions in
  the `applyFilters` block covering each result choice and its combination with
  the other filters.
- `npm --prefix frontend run check:build` -- OK (2 models bundled).
- Browser check on the **built** site via `scripts/serve-frontend.sh`, with the
  stats API mocked (`playwright-cli route`) against a 12-game fixture, since a
  local build has no `VITE_STATS_ENDPOINT`:
  - Desktop (1280x720) and mobile (360x732, DPR 3, touch -- viewport confirmed
    with `playwright-cli eval` before screenshotting).
  - Selecting **human won** took the list from `11 of 12 games` to
    `3 of 12 games`, and all three rendered rows read "human won".
  - `playwright-cli console error` -- 0 errors, 0 warnings, in both sessions.
  - Mobile layout: `document.body.scrollWidth` is 360 against an `innerWidth`
    of 360, i.e. the extra picker adds no horizontal overflow; the fieldset
    simply wraps from two rows to three, and the Result control measures
    91x39 px at x=144.

No separate formatting commit: the repo configures no JS/Svelte formatter, and
no Rust files were touched.

## Screenshots

Desktop, default filters -- before and after (the new picker sits between Status
and Model):

| before | after |
| --- | --- |
| ![before](https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/5f9581db789ce6297cfaa75c7e203e01ca753fd4/docs/superpowers/results/images/stats-result-filter/before-desktop.png) | ![after](https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/5f9581db789ce6297cfaa75c7e203e01ca753fd4/docs/superpowers/results/images/stats-result-filter/after-desktop.png) |

Mobile (360x732), default filters -- the row wraps to three lines:

| before | after |
| --- | --- |
| ![before](https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/5f9581db789ce6297cfaa75c7e203e01ca753fd4/docs/superpowers/results/images/stats-result-filter/before-mobile.png) | ![after](https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/5f9581db789ce6297cfaa75c7e203e01ca753fd4/docs/superpowers/results/images/stats-result-filter/after-mobile.png) |

The filter doing its job -- **Result: human won**, `3 of 12 games`:

![human wins only](https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/5f9581db789ce6297cfaa75c7e203e01ca753fd4/docs/superpowers/results/images/stats-result-filter/after-desktop-human-wins.png)
