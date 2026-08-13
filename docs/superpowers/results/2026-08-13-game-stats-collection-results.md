# Record games played on the site

The play site keeps nothing. Refresh the tab and the game is gone, and we have
no idea how many games get played, how the models actually do against people,
or what a lost game looked like. This adds storage: one row per game, in a
hosted database, with the full move list so any game can be replayed.

Plan: `docs/superpowers/plans/2026-08-13-game-stats-collection.md`

This is collection only. No stats page and no replay viewer yet — those are
worth building once there are real games to look at.

## Which database

**Cloudflare D1** (managed SQLite) behind a small Cloudflare Worker.

- **It does not fall asleep.** A Supabase free-tier project pauses after about
  a week without traffic and needs a manual restore. At the expected 2-3 games
  a day, a quiet fortnight would silently stop collection.
- **The credential stays server-side.** Writing to Supabase or Firestore
  straight from the browser means shipping a write token in the bundle and
  pushing all validation into RLS policies or security rules. The worker keeps
  the database binding private, validates payloads as ordinary TypeScript, and
  refuses writes from any origin but the play site.
- **It is where the request metadata is.** IP, user agent and country are read
  from the request rather than trusted from the client.
- **Headroom is not a concern.** 100k worker requests and 100k D1 row writes a
  day, free. Writing after every move on a 60-move game is ~60 writes; ten
  games a day is ~600.

The cost is one more deploy target. Deployment is manual (`npx wrangler
deploy`) — the worker changes far less often than the site, and automating it
would mean putting a Cloudflare API token in the repo's secrets.

## What is stored

One `game` row, created at game start and rewritten after every move:

| | |
|---|---|
| Identity | `game_id` (client UUID), `client_id` (anonymous, in localStorage), `started_at`/`updated_at` (server clocks) |
| Outcome | `status` (`in_progress`/`finished`/`abandoned`), `outcome` (`human_win`/`ai_win`/`draw`), `winner` |
| The game | `moves`, `move_count`, `action_log`, `undo_count`, `duration_ms` |
| Setup | `model_label`, `model_id`, `board_size`, `max_walls`, `max_steps`, `human_player`, the four MCTS settings |
| Environment | `app_version` (git sha), `webgpu_ok`, `ip`, `user_agent`, `country` |

The model is identified by the label shown in the picker — `9×9, 10 walls (v0)`
— rather than a hash of the weights. That is the simple option and it is enough
as long as the version in the label is bumped whenever a model is retrained;
`CONTRIBUTING.md` now says so, next to the field it applies to. Without that,
two different networks shipped under one label become indistinguishable in the
data.

Nothing personal is collected and there is no account. The README says plainly
what is recorded.

### Two move columns, because of undo

`Game.undo(n)` replays from the initial state, so an undone move simply
disappears from the history the engine reports. A record built on that history
alone would silently lose the fact that a move was played and taken back — and
guarding the write with "the move list may never shrink" would be worse than
useless, leaving a splice of two different games that no longer replays.

So the row carries both:

- **`moves`** — the current history. It shrinks on undo and always replays
  cleanly to the position on screen.
- **`action_log`** — append-only: `[{"m":12},{"m":40},{"u":2},{"m":17}]`, where
  `m` is an action index played and `u` is a takeback of *n* plies.

The reporter derives the log by diffing each new history against the previous
one, so undo needs no call site of its own; `undo_count` falls out of the log.

## Abandoned games

People walk away when the result becomes obvious, which is exactly the position
worth having. The record is rewritten after **every** move, so it is never more
than one move behind what the player saw. On top of that, a game is marked
`abandoned` when the player starts a new one or switches model mid-play, and on
`pagehide`/`visibilitychange` via `sendBeacon`. A backgrounded tab that comes
back is not written off — the next write puts the game back in progress. A game
still `in_progress` with nobody around was lost to a crash or a killed tab, and
its moves are there regardless.

Writes are ordered by a client-side `rev` counter, enforced in the `ON CONFLICT`
clause: a write is applied only if its `rev` beats the stored one and the game
is not already `finished`. A late beacon cannot overwrite a win, and a retry
that overtakes its predecessor is dropped by the database rather than by a
read-then-write race.

## Safety

Nothing on this path can affect a game. Every request is fire-and-forget with
`keepalive`, every failure is swallowed, and the whole thing is inert unless the
build was given an endpoint — which only the Pages workflow does. Local play and
CI builds write nothing.

Requests use a `text/plain` content type so each per-move write stays a CORS
simple request and skips the preflight round trip.

## Before this collects anything

Three manual steps, all in `stats-worker/README.md`:

1. `npx wrangler d1 create quoridor-stats`, put the printed id in
   `wrangler.toml`, and apply `schema.sql` with `--remote`.
2. `npx wrangler deploy`, which prints the worker URL.
3. Set that URL as the repository variable `STATS_ENDPOINT` (Settings →
   Secrets and variables → Actions → Variables). Until it is set, the deployed
   site simply reports nothing — the build reads `vars.STATS_ENDPOINT` and an
   unset variable is an empty string.

## Verification

Unit tests: 20 new frontend tests (`frontend/src/lib/stats.test.ts`) and 28
worker tests. `sql.test.ts` runs the real `UPSERT_SQL` against the real
`schema.sql` in an in-memory SQLite, so the ordering guard is tested rather than
paraphrased — stale revisions ignored, finished games never overwritten,
undo-shortened lists accepted.

End to end, against `wrangler dev` with a local D1 and the built site in a
browser:

| Checked | Result |
|---|---|
| Game played to a human win | `finished`, `human_win`, winner 0, 9 moves |
| Undo mid-game | `moves` shrank to 4; log kept `{"m":17},{"m":42},{"u":2}`; `undo_count` 1 |
| Model switched mid-game | previous game `abandoned` with its moves; new row started |
| Navigated away mid-game | `abandoned` at rev 4 with both moves intact |
| Stale `rev` and a late `abandoned` beacon after a win | both ignored; row stayed `finished` |
| Bad origin / oversized body / invalid action index | 403 / 413 / 400, nothing written |
| Request metadata | `ip`, `user_agent`, `country` populated from headers |
| `webgpu_ok` | null on the first write, `1` once the async probe answered |

Also run: `svelte-check` (0 errors), `npm run build`, `check:build`, and a
confirmation that a build without `VITE_STATS_ENDPOINT` contains no endpoint at
all.

The step-cap draw was exercised through unit tests and curl rather than by
playing 50 moves in the browser.

## Noticed, not fixed

- **The step-cap draw is invisible in the UI.** The engine treats
  `completed_steps >= max_steps` as game-over with no winner, but `App.svelte`
  only checks `winner`, so the status line keeps saying "Your move" while the
  worker rejects every move with "game is already over". The stats detect the
  draw correctly; the UI bug predates this change.
- **`npm --prefix frontend run dev` is broken** and was before this change:
  Vite dev serves the models' `meta.json?import` as `application/json`, so the
  glob import fails the module MIME check and the page never renders. `npm run
  build` + `npm run preview` — the flow the README documents — works fine, and
  is what the browser verification above used.

## Commits

Two, both functional: the worker and schema, then the browser reporting. There
is no formatting commit — the repo configures `ruff` for Python and `cargo fmt`
for Rust, and this change touches neither.
