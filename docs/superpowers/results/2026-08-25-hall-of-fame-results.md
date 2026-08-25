# A hall of fame on the setup screen

The setup screen was a form and nothing else: pick a nickname, a model, a side, a
level, press Start. Nothing on it said that anyone had ever played this, or that
the opponent can be beaten. Every game is already recorded — the stats page lists
thousands — but that record is one click away and reads as a table, not as an
invitation.

Above `Start game`, the five most recent human victories against the selected
model, in prose. A footer link to the source repository rides along on both pages.

Design: `docs/superpowers/specs/2026-08-24-hall-of-fame-design.md`
Plan: `docs/superpowers/plans/2026-08-25-hall-of-fame.md`

## Before and after

| Before | After |
|---|---|
| ![before](https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/1287a3386d2170caedd66688ca038169bb3de3a2/docs/superpowers/results/images/hall-of-fame/before-desktop.png) | ![after](https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/1287a3386d2170caedd66688ca038169bb3de3a2/docs/superpowers/results/images/hall-of-fame/after-desktop.png) |

A model nobody has beaten yet, and the phone viewport:

| Empty state | Mobile 360×732 |
|---|---|
| ![empty](https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/1287a3386d2170caedd66688ca038169bb3de3a2/docs/superpowers/results/images/hall-of-fame/after-desktop-empty.png) | ![mobile](https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/1287a3386d2170caedd66688ca038169bb3de3a2/docs/superpowers/results/images/hall-of-fame/after-mobile.png) |

## What it shows

Five recent human wins against the **selected model**, at any level. The level is
not a filter — it is part of each sentence:

```
Recent human wins against 9×9, 10 walls (v0)

  Julian won as P2 on Normal in 43 moves, 5 days ago.
  ana won as P1 on Difficult in 51 moves, 1 day ago.
  kiko won as P2 on custom settings in 38 moves, 3 weeks ago.
```

Filtering by model *and* level was the first instinct and is wrong for this
database: most combinations would be empty most of the time, and an empty hall of
fame on a fresh model teaches a new player nothing about the opponent they are
about to face.

**How long ago, not a date.** An absolute date has to be formatted in some locale,
and the viewer's locale is the wrong one inside an English sentence — a Japanese
visitor would have read `in 43 moves, 2026年8月12日.` The stats page can use the
viewer's locale because it is that viewer's table; this is public prose. Rounded
English also answers what a reader actually wants from a wall of *recent* wins.

Games won with takebacks count. The schema notes they are not clean samples of AI
strength, which is true — but this is a wall in the clubhouse, not a benchmark.

## The part worth reading the diff for

The worker's `GET /v1/games` gains `outcome` and `model_id`, so the browser asks
one narrow question instead of downloading the history. No schema change: both are
existing columns.

The client then **revalidates every row it gets back**, because merging publishes
the frontend through Pages immediately while the worker's deploy parks waiting for
an approval click. In that window the new page is live against a worker that has
never heard of the new parameters — and an old `parseListQuery` ignores what it
does not know, answering with the newest games of any kind.

That much was designed in. What the whole-branch review caught is that it was only
half a fix, and the design document contradicted itself about the other half. The
spec claimed revalidation "turns that into an empty block, which is wrong but not
a lie." But the zero-wins state is not a blank block — it is a positive assertion,
*Nobody has beaten this model yet — be the first.* Since a game record is written
as `in_progress` before a single move, the newest rows are overwhelmingly
`outcome: null`; revalidation would drop all of them; and the page would then tell
every visitor, as fact, that nobody had ever beaten that model.

The fix is exact rather than heuristic. `model_id` and `outcome` are BINARY-collated,
so SQL `=` and JS `===` agree — a correctly-filtering worker can never return a row
the client drops. Any dropped row is therefore proof the worker did not filter, and
`fetchRecentWins` now throws on that signature instead of returning an empty list
the caller cannot tell apart from a real zero. A genuinely empty response still
produces the zero-wins line, which is the one case where it is true.

## Verification

Worker and frontend suites green (frontend 151/151, worker 62/62 with no skips —
`sql.test.ts` needs Node 22 and skips itself silently on older runtimes),
`svelte-check` clean, `check:build` clean, and `wrangler deploy --dry-run` with an
empty token.

**Browser pass**, against the built site under `scripts/serve-frontend.sh` with a
local CORS-serving mock stats API — never the dev server, which does not work in
this repo. Measured, not eyeballed:

- The block is above the button, not merely near it: `hofBottom` 812 <
  `buttonTop` 826, gap exactly **14px**, matching `.setup`'s own `gap: 14px`.
- A nickname of `<b>bold</b><script>alert(1)</script>` rendered as literal text:
  0 `<b>` elements, 0 `<script>` elements, `innerHTML` showing `&lt;b&gt;`.
- Switching models replaced the heading and showed the zero-wins line — not the
  previous model's sentences, which is the stale-response guard working.
- Mobile 360×732 (dpr 3, viewport confirmed by `eval` before the screenshot):
  `document.body.scrollWidth` 360 = `innerWidth` 360, no horizontal overflow. The
  mock includes a 37-character nickname specifically to try to push it over.
- `playwright-cli console error` empty on every page checked, including the stats
  page, where the footer was confirmed with its `href`, `target` and `rel`.

One process note, because it nearly produced a false record: the first mobile
before/after pair came out **byte-identical**. At 360px the block sits below the
fold, so a viewport screenshot of the top of the page shows nothing different. Both
mobile shots were retaken full-page.

## Shipping

Worker and frontend ship together, which the automated worker deploy made possible —
when this was designed they had to be split so the frontend would not sit waiting on
someone's laptop.

The merge does two things at once: Pages publishes the site, and the worker's deploy
parks waiting for approval. So **the block ships empty and approving the parked
deploy fills it**. Nothing is wrong in between, which is what the revalidation buys.

Worth confirming right after shipping: before approving the worker deploy, the block
should render nothing at all — not the zero-wins line. That is the fix above doing
its job in production.
