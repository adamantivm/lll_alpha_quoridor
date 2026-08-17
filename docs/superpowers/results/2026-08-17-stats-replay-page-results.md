# A stats and replay page for the recorded games

Games played on the site have been recorded into Cloudflare D1 since
`docs/superpowers/results/2026-08-13-game-stats-collection-results.md`, but there
was nothing to look at them with: querying meant `wrangler d1 execute`, and no
recorded game could be watched back. This adds the viewer — a second static page
on the same GitHub Pages site, at **`/stats.html`** — and the two read endpoints
it needs.

Plan: `docs/superpowers/plans/2026-08-17-stats-replay-page.md`

## What the page shows

**Summary, grouped by (model, MCTS sims, c_puct)** — the three settings that
decide how strong the AI plays. Per group: games played, how many finished, the
AI's record overall and **split by the seat it played** (P1 is the side that moves
first, so the AI is P1 exactly when the human chose to move second), human wins,
draws, and plies per finished game as median, mean and min–max, plus the mean
plies of AI wins against human wins.

Leaf parallelism and virtual loss are deliberately *not* part of the grouping key:
they change how the search batches, not what it converges to, and splitting on
them would only thin out already small samples. The values seen in each group are
reported, so a surprise there is still visible.

Two conventions, both stated on the page: win rates count **finished games only**
(an abandoned game has no result, and counting it as anything would bias the
rate), and games where the player took a move back are **excluded by default** —
they are not clean strength samples. Both are one click away.

**Games list** — every recorded game, finished or not, with date, player, model,
settings, which seat the AI had, result, plies, takebacks and duration. Filters
for player, status, board size and build.

**Replay** — pick a game and step through it: first/prev/play/next/last, a
scrubber, ← and → keys, and a clickable ply list ("12 · ada · move to (4, 4)",
"13 · AI · wall h at (3, 2)"). Opens on the final position. `?game=<id>` deep-links
straight to one game.

The replay feeds the stored action indices back through the same wasm engine that
played the game, so the position on screen is the position that was really on the
board, not a re-derivation that could disagree. That also means `Board.svelte`
renders it **unmodified**, and this page never loads onnxruntime — the stats
bundle is ~31 KB of JS plus the 140 KB engine, against the play page's 24 MB of
ORT runtime.

## Read endpoints

Two, on the existing worker:

| | |
|---|---|
| `GET /v1/games?limit=&cursor=&status=` | Newest first, without the move lists. `{games, next_cursor}` |
| `GET /v1/games/{game_id}` | One game, with `moves` and `action_log`. `{game}`, or 404 |

Both sit behind the origin allowlist and the per-IP rate limit the write path
already used, and answer with `cache-control: public, max-age=30`.

- **`ip` and `user_agent` are not exposed, and must stay that way.** The page is
  public and no statistic on it needs either; both are collected server-side for
  abuse handling only. A test asserts the selected column set excludes them.
  `country` is coarse enough to show, and is interesting.
- **Pagination is keyset, not OFFSET**, on the `(started_at, game_id)` pair.
  `started_at` is a server timestamp with no uniqueness guarantee: with a plain
  `started_at <` cursor, two games recorded in the same millisecond would cost one
  of them a page. There is a test with two such games.
- **A bad `limit`, `cursor` or `status` is a 400**, not a silent default: a caller
  paginating with a cursor the worker cannot parse would otherwise loop over page
  one forever.
- **The client's paging loop terminates** on a short page, a null cursor, an empty
  page, or a 5000-row cap — after which the page says it is showing the most
  recent 5000 games rather than presenting a partial history as the whole one.

No schema change and no migration: `idx_game_started` already covered the order,
and `ALLOWED_ORIGINS` already listed the Pages origin and the localhost preview
ports.

## Why aggregate in the browser

The page fetches the rows once and groups them in `frontend/src/lib/aggregate.ts`.
The alternative was `GROUP BY` in SQL behind a `/v1/summary` endpoint. Client-side
won on two counts: the filters become instant instead of a round trip each, and
every statistic is a pure function with a test rather than SQL that needs a worker
deploy to change. It stops scaling somewhere north of a few thousand games, which
is what the row cap is for — the answer then is a summary endpoint, not a bigger
download.

## Verification

- `npm --prefix stats-worker run typecheck && npm --prefix stats-worker run test`
  — 55 tests. New: pagination order, the same-millisecond cursor tiebreak, the
  status filter, `SUMMARY_COLUMNS` against the real `schema.sql`, GET routing,
  limit/cursor rejection, 404 for an unknown or malformed id, a read from a
  disallowed origin, reads under the rate limit, and read failures.
- `npm --prefix frontend run test` — 80 tests, of which 28 are new: grouping and
  the seat split, rates over finished games only, ply statistics, the filters, URL
  derivation, the paging loop and row cap, and the replay's view accumulation
  including the refused-action stop path.
- `svelte-check --threshold error`: clean. `npm run build` + `check:build`: clean,
  with `dist/stats.html` emitted alongside `dist/index.html`.
- **End to end in a browser.** Applied `schema.sql` to a local D1, seeded 24 games
  by playing random legal moves through the real wasm engine and POSTing each
  record to `wrangler dev`, then built the frontend against
  `http://localhost:8787/v1/games` and drove `/stats.html`: the summary grouped 28
  games into 8 rows with the P1/P2 split, the games list loaded, selecting a game
  replayed it (opening position correct, walls and the last-action highlight
  correct, stepping and the ply list in step), the `?game=<id>` deep link survived
  a reload, and the filters cut 28 games to 9 and then 6. One page load costs one
  list request and one detail request. No console errors, and the play page at `/`
  still plays — including its stats POST, which the router refactor left working.

## Deployment

**One manual step: `cd stats-worker && npx wrangler deploy`.** The read endpoints
do not exist until the worker is redeployed; until then the deployed stats page
will say it cannot reach the API. Worker deployment was already manual — it needs
a Cloudflare API token, and the worker changes far less often than the site.

The page itself needs nothing new: the Pages workflow uploads all of
`frontend/dist`, and the stats page reads from the same `VITE_STATS_ENDPOINT` the
play page already writes to (`${endpoint}` for the list, `${endpoint}/{game_id}`
for one game), so there is no second variable to set.

## Noticed, not fixed

- The two bugs recorded in the collection results doc are still open: the step-cap
  draw is invisible in the play UI, and `npm --prefix frontend run dev` does not
  serve the app (build + preview does).
- Nothing asks the player for a nick yet, so most rows still read `unknown`. The
  page groups and filters by nick already, so that change gets a payoff for free.
