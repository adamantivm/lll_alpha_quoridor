# Plan: a stats and replay page for the recorded games

Every game played on the static site is recorded into Cloudflare D1 by
`stats-worker` (one row per game, rewritten after every move). Looking at that
data means `npx wrangler d1 execute`, and nothing replays a game — the collection
change deliberately stopped short of a viewer until there were real games to look
at. There are now, so build the viewer: a second static page on the same GitHub
Pages site that

- summarises the AI's record grouped by **(model, mcts_n, c_puct)**,
- splits AI wins by whether the AI moved **first (P1)** or **second (P2)**, with
  human wins, draws and move-count statistics,
- lists the recorded games and replays any one of them ply by ply.

Two facts make this cheap. `game.moves` is exactly the wasm engine's
`move_history` (flat action indices), stored next to `board_size`, `max_walls`,
`max_steps` and `human_player` — everything needed to reconstruct the game. And
`frontend/src/lib/Board.svelte` already renders a `StateView`, so replay needs
`quoridor-wasm` but no onnxruntime.

The one gap: the worker is write-only.

## Decisions

- **Read endpoints on the existing worker**, not a JSON snapshot committed by CI.
  Live data, and no Cloudflare API token in the repository's secrets.
- **Aggregate in the browser.** The filters are then instant and every statistic
  is a pure function with a test, instead of SQL that needs a worker deploy to
  change. Capped at 5000 rows; past that the answer is a server-side summary, not
  a bigger download.
- **A second Vite entry (`stats.html`) in the existing `frontend/` app**, so the
  board renderer, the wasm build wiring and the Pages workflow are all reused.
- **A1 is the AI side**, and player 1 is the side that moves first, matching the
  play UI's "First (P1)" / "Second (P2)". The AI is P1 exactly when
  `human_player === 1`.

## 1. Read endpoints in `stats-worker`

No schema change and no migration: `idx_game_started` already covers the
pagination order, and `ALLOWED_ORIGINS` already lists the Pages origin and the
localhost preview ports.

In `src/sql.ts`, next to `UPSERT_SQL` (same reason it lives there — `sql.test.ts`
runs these against the real `schema.sql` under `node:sqlite`):

- `SUMMARY_COLUMNS`: every column except `moves`, `action_log`, `ip`,
  `user_agent`. `ip` and `user_agent` must stay unexposed — the page is public
  and no statistic needs either. `country` stays.
- `listStatement(query)`: newest first, keyset-paginated on the
  `(started_at, game_id)` pair. The pair matters: `started_at` is a server
  timestamp with no uniqueness guarantee, and a plain `started_at <` cursor would
  hide one of two games recorded in the same millisecond.
- `GAME_SQL`: those columns plus `moves` and `action_log`, by id.
- `parseListQuery`, `encodeCursor`, `rowToSummary`, `rowToDetail`: pure, so the
  400s and the 1/0 → boolean normalisation are tested directly.

In `src/index.ts`: `GET /v1/games` → `{games, next_cursor}`, `GET /v1/games/{id}`
→ `{game}` or 404, both behind the existing origin allowlist and rate limit, with
`cache-control: public, max-age=30`. `GET` joins the advertised CORS methods, and
the POST body moves into a `handleWrite()` helper so `fetch` stays a router.

## 2. The page

New: `frontend/stats.html`, `src/stats.ts`, `src/StatsApp.svelte`,
`src/lib/statsApi.ts` (URL derivation from `VITE_STATS_ENDPOINT`, paging,
row cap), `src/lib/aggregate.ts` (grouping and every statistic, pure),
`src/lib/replay.ts` (`buildReplay` against an injected engine),
`src/lib/SummaryTable.svelte`, `src/lib/GameList.svelte`, `src/lib/Replay.svelte`.

Changed: `vite.config.ts` gains the second entry; `scripts/check-build.mjs`
checks both pages for root-absolute URLs and fails if `stats.html` is missing;
`App.svelte` links to the new page.

Replay builds one `StateView` per ply once, up front, so scrubbing costs nothing,
and renders them through `Board.svelte` unmodified — which flips the board on
`human_player`, so the human is always the blue pawn at the bottom. Ply labels
come from each view's own `last_action`, so no action-index decoding is
duplicated in TypeScript.

Tests: `aggregate.test.ts`, `statsApi.test.ts`, `replay.test.ts`, plus the new
worker cases in `sql.test.ts` and `index.test.ts`.

## Not doing

No new columns, no migration, no auth on reads. Not touching the nick UI, and not
fixing the two bugs recorded in
`docs/superpowers/results/2026-08-13-game-stats-collection-results.md`.

## Verification

Worker: `npm --prefix stats-worker run typecheck && npm --prefix stats-worker run test`.

End to end against a local D1: apply `schema.sql` with `--local`, `npx wrangler
dev`, seed games by playing random legal moves through the wasm engine and POSTing
them, then check the list, the cursor, the detail endpoint and the 400/403/404
paths with curl. Build the frontend with `VITE_STATS_ENDPOINT` pointing at
`localhost:8787`, `npm run preview`, and drive `/stats.html` in a browser:
grouping, the P1/P2 split, the filters, a replay stepping ply by ply, and the
`?game=<id>` deep link. `npm run dev` does not work for this app (Vite serves the
models' `meta.json?import` as JSON), so build and preview.

## Delivery

Branch `vibe/stats-replay-page`, one commit per step, PR body from the results
doc. The worker's read endpoints only exist once someone runs `npx wrangler
deploy` in `stats-worker/` — a manual step, as deployment already is.
