# Hall of fame on the setup screen

## Problem

The setup screen is a form and nothing else: pick a nickname, a model, a side, a
level, press Start. Nothing on it says that anyone has ever played this, or that
the opponent can be beaten. Every game is already recorded — the stats page
lists thousands of them — but that record is one click away and reads as a
table, not as an invitation.

Show, immediately above `Start game`, the most recent human victories against
the selected model, in prose.

A second, unrelated change rides along in the same PR: a footer link to the
source repository, on both pages.

## Design

### What the block shows

The five most recent human wins against the **selected model**, at any level.
The level is not a filter — it is part of each sentence. A player switching
between Easy and Difficult sees the same five lines; a player switching models
sees a different five.

Filtering by model *and* level was the first instinct and is wrong for this
database: most combinations would be empty most of the time, and an empty
hall of fame on a fresh model teaches the player nothing about the model they
are about to play.

```
Recent human wins against 9x9, 10 walls (v0)

Julian won as P2 on Normal in 43 moves, 12 Aug 2026.
ana won as P1 on Difficult in 51 moves, 11 Aug 2026.
kiko won as P2 on Easy in 38 moves, 9 Aug 2026.
```

Per line: nick, side, level, move count, date. Not duration, not country — the
sentence is already at the length where one more clause makes it a table again.

`human_player === 0` is P1. `preset` is `"unknown"` for games recorded before
levels existed and `"custom"` for hand-edited parameters; those print as
`on an unknown level` and `on custom settings` rather than being dropped.

Games with takebacks (`undo_count > 0`) count. The schema notes that they are
not clean samples of AI strength, and that is true — but this is a wall in the
clubhouse, not a benchmark, and excluding them would need a third query
parameter to buy a distinction no player is making.

### States

| State | What renders |
|---|---|
| No `VITE_STATS_ENDPOINT` (dev, CI) | Nothing. The block is absent from the DOM. |
| Request in flight | Nothing. No spinner: the block is decoration, and a spinner above the primary button reads as the page not being ready. |
| Request failed | Nothing. A hall of fame does not justify an error message on the screen a player came to press one button on. |
| Zero wins | `Nobody has beaten this model yet — be the first.` |
| 1–5 wins | The sentences. |

### The worker: two more filters

`GET /v1/games` filters by `status` today. Add two more, in the same shape:

- `outcome` — validated against `human_win|ai_win|draw`, exactly as `status` is
  validated against its three values. A bad value is a 400.
- `model_id` — an exact-match string, rejected over 64 characters (the catalogue
  ids are short slugs like `b9w10-v0`).

`parseListQuery` grows two blocks that mirror the `status` block; `listStatement`
pushes two more predicates onto the `WHERE` array it already builds. Ordering,
keyset pagination, the 30-second read cache and the rate limit are untouched. An
unknown `model_id` yields an empty list, not an error — it is a filter, not a
lookup.

`idx_game_model` is on `model_label`, not `model_id`. Left alone: this query is
`LIMIT 5` over a table in the thousands, behind a 30-second cache.

### The frontend: `fetchRecentWins`

`statsApi.ts` already holds `listUrl` and the response parsing, and already
takes `fetchImpl` as a parameter so it tests without a network. Add:

```ts
fetchRecentWins(endpoint, modelId, limit, fetchImpl): Promise<GameSummary[]>
```

One GET, `limit=5&outcome=human_win&model_id=…`, about 2KB of response.

**It revalidates every row it gets back** (`outcome === "human_win" &&
model_id === modelId`). This is not defensive habit, it is the deploy story.

The worker now deploys from CI, but not on the same trigger as the frontend: one
merge to `main` publishes the site through Pages immediately and parks the
worker's deploy waiting for a reviewer's approval. Between those two moments —
minutes or days, depending on when someone clicks — the new page is live against
a worker that has not learned the filters.

An old `parseListQuery` ignores parameters it does not know, so that worker
answers this request with *the five newest games of any kind*: a hall of fame
full of other people's losses against other models, presented as human victories.
Revalidating turns that into an empty block, which is wrong but not a lie.

The play page has never read from the stats API — only written to it. This adds
one GET to its load. It is not on the critical path: the component renders
without it and the game starts without it.

### The component: `HallOfFame.svelte`

Its own file. `SetupScreen.svelte` is already 200 lines of form and does not
need a fetch lifecycle in it.

Props: `modelId`, `modelLabel`. It refetches when `modelId` changes, and
discards a response whose model no longer matches the current selection — a slow
answer for the previously selected model must not land under the new model's
heading.

Nicks are player-supplied text and go through Svelte's normal interpolation,
which escapes them. No `{@html}` anywhere in this component.

The prose builder is a pure function in `lib/hallOfFame.ts` — `GameSummary` in,
string out — so the sentence forms are tested without a DOM.

### The footer link

`SiteFooter.svelte`, rendered at the end of both `App.svelte` and
`StatsApp.svelte`: *Open source — read the code on GitHub.* The repository URL
is a constant in the component. `target="_blank"`, `rel="noopener noreferrer"`.

On the play page it sits below the setup card and below the board, so it is
present during a game too. Small, muted, not competing with `Start game`.

## Testing

**Worker** (`sql.test.ts`, against real SQLite as the existing tests do):
`parseListQuery` accepts and rejects each new parameter; `listStatement`
combines `status`, `outcome`, `model_id` and a cursor into one statement with
its binds in placeholder order; a query filtered by model returns only that
model's rows.

**Frontend** (`statsApi.test.ts`, `hallOfFame.test.ts`): `fetchRecentWins` builds
the right URL; it drops rows an old worker returned unfiltered; it surfaces a
failed request as a rejection the component swallows. The prose builder covers
P1/P2, `unknown` and `custom` presets, and the singular case of one move.

**Browser**, per AGENTS.md, after `svelte-check`, vitest and `check:build` pass:
the built site under `scripts/serve-frontend.sh --build`, against a local mock
endpoint that serves CORS headers and canned games, so the block has data to
render. Desktop and 360×732, viewport confirmed by `playwright-cli eval` before
either screenshot is called mobile, and `playwright-cli console error` read on
both. Before/after screenshots committed under
`docs/superpowers/results/images/hall-of-fame/`.

## Out of scope

- Filtering the block by level.
- A "you" highlight for the current nickname's own wins.
- Any change to how games are recorded. This reads what is already written.

## Shipping

Worker and frontend ship in one pull request. That is new: when this was
designed, the worker deployed by hand, and the two halves had to be split so the
frontend would not sit waiting on someone's laptop. `stats-worker-deploy.yml`
removed that constraint.

The merge does two things at once — Pages publishes the site, and the worker's
deploy parks waiting for approval. So the ordering is: the block ships empty,
and approving the parked deploy fills it. Nothing is broken in between, which is
what the client-side revalidation above buys.

An index on `model_id` is now cheap to add — schema changes are migration files
that CI applies before the code. Still declined: this is a `LIMIT 5` over a
table in the thousands, behind a 30-second cache. `idx_game_model` on
`model_label` stays as it is. Worth revisiting only if the games table grows by
orders of magnitude.
