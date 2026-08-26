# Show takeback games on the stats page by default

A win visible in the play page's hall of fame — adamantivm, P1, Easiest,
25 Aug — was missing from the stats page. It was in the database the whole
time: the game has `undo_count: 1`, and the stats page shipped with
"Exclude games with takebacks" ticked, which hid it along with 37 of the
124 recorded games.

The two pages had opposite, separately-reasoned defaults: the hall of fame
counts takeback wins ("a wall in the clubhouse, not a benchmark"), the stats
page dropped them to keep clean strength samples. Takebacks turn out to be
common — a mis-tap on a phone has to be undone — so the clean-sample default
was hiding ordinary games and making the two pages disagree.

`DEFAULT_FILTERS.excludeUndos` is now `false`. The filter itself is unchanged;
it is opt-in rather than on by default. Note this moves the headline win rates,
which previously described the no-takeback subset.

## Verification

`npm --prefix frontend run test` (151 pass), `build`, `check:build`. In a real
browser against the built site with the live API payload: the checkbox starts
unchecked, the count reads `107 of 107 games`, the missing game is in the list
(`8/25/26, 9:30 PM · adamantivm · Easiest · P2 · human won · 69 plies · 1 undo`),
and no console errors. Ticking the box still filters, back to `70 of 107`.
