# Stats page: filter by result

## Goal

On the stats page, let the viewer narrow the game list to a particular result --
in particular "only the games humans won".

## Approach

The stats page already filters client-side over the full `GameSummary[]` in
`applyFilters` (`frontend/src/lib/aggregate.ts`), with one `<select>` per field
in `StatsApp.svelte`. A result filter is one more field of the same kind:
`GameSummary.outcome` is already `"human_win" | "ai_win" | "draw" | null`, so
nothing new has to be fetched or computed.

1. `Filters` gains `outcome: GameOutcome | null`, defaulting to `null` (any).
2. `applyFilters` gains the matching clause, alongside the existing ones.
3. `StatsApp.svelte` gains a "Result" `<select>`: any / human won / AI won /
   draw, wired the same way as the Status picker.

Only finished games carry an outcome, so picking a result implicitly restricts
to finished games -- that is the desired behaviour and needs no extra clause.

## Tests

Extend the `applyFilters` block in `frontend/src/lib/aggregate.test.ts`: a
`human_win` game, an `ai_win` game and an outcome-less abandoned one, asserting
each choice selects the right ids and that the default keeps them all.

## Verification

- `npm --prefix frontend run check` (svelte-check) and `npm --prefix frontend test`
- `npm --prefix frontend run check:build`
- Browser check with `playwright-cli` on the built site (this changes what the
  user sees), desktop and mobile viewports, plus `playwright-cli console error`.
  The dev/local build has no `VITE_STATS_ENDPOINT`, so the page shows the
  "no stats endpoint" note; build with a stub endpoint and serve fixture JSON so
  the filter row actually renders.
- Before/after screenshots under
  `docs/superpowers/results/images/stats-result-filter/`.
