# Follow-up cleanup after PRs #11 and #12

Six known correctness issues from the stats/replay page and the new setup screen,
each with the regression test it was missing. No redesign, no new dependency, no
state-management layer: the two new modules exist because the bugs live in
sequencing that a Svelte component keeps out of reach of a test.

## What changed

### 1. Stale replay selections can no longer overwrite the current one

Picking a game fetched its detail inline, so clicking through the list faster
than the network answers could leave game A — or A's error message — on screen
after B had already loaded. `lib/selectGame.ts` keeps a sequence number and lets
only the newest selection write to the page. It is a counter and two setters,
not a request manager.

### 2. Summary rows describe exactly one opponent

`groupKeyOf` now includes leaf parallelism and virtual loss alongside model,
sims and c_puct. They were previously reported per row but not grouped on, so
games played with measurably different search behaviour shared a win rate that
described no configuration in particular — while the setup screen itself warns
that leaf parallelism can cost strength. `GroupStats` carries both as scalars
and the table shows both as columns.

### 3. A full history is no longer reported as truncated

The worker returns a cursor for any page that comes back full, so a database
holding exactly `MAX_ROWS` games made the page claim the rest were being
withheld. When the row budget runs out the client now makes one `limit=1` probe
and only warns if a row comes back. The paging fake in the tests had hidden the
bug by never returning a cursor on the final page; it now mirrors the worker.

### 4. A game that fails to start no longer stays open in the database

`stats.startGame()` ran before `ai.newGame()`, so a model that would not load,
or wasm that would not start, left an `in_progress` record for a game nobody
played. The worker's first error now abandons that record — unless a position
has already arrived, in which case the game is real and the error is mid-game.

### 5. The setup/start/new-game lifecycle has tests

The lifecycle moved out of `App.svelte` into `lib/session.ts`: a small
non-reactive object holding one fact (has a playable position arrived) and the
pure builders `statsMetaFor` / `aiRequestFor` / `awaitingHuman`. All the Svelte
state stays in the component. The tests drive it against the *real* stats
reporter, so what is asserted is what would reach the worker:

- nothing is sent before **Start game**;
- Start sends exactly one initialization, and the record describes the same
  model, board, seat and search settings as the AI request;
- a blank nickname starts nothing;
- a failed initialization abandons the record, and going back to setup does not
  write it off twice;
- an error *after* play has begun leaves the game running;
- New Game abandons an unfinished game exactly once;
- a finished game is never rewritten as abandoned;
- choosing P2 sends `humanPlayer: 1` and the first position already carries the
  AI's opening move, with control passing to the human only after it.

### 6. Replaying another build's game says so

Replays run stored action indices through the wasm engine *this* build ships. An
illegal stored move is already caught; a rules change that keeps every move legal
and only changes its meaning is not. `buildWarning()` compares the recorded
`app_version` with `__APP_VERSION__` and Replay.svelte shows a note above the
board — a note, not a block, since the usual reason two builds differ has nothing
to do with the rules. Records predating the version stamp get a generic warning.

## Verification

| Check | Result |
| --- | --- |
| `npm --prefix frontend run test` | 109 passed (11 files) |
| `svelte-check --threshold error` | 0 errors (1 pre-existing `Board.svelte` a11y warning) |
| `npm --prefix frontend run build` | clean |
| `npm --prefix frontend run check:build` | OK, 2 models bundled |
| `npm --prefix stats-worker run typecheck` | clean |
| `npm --prefix stats-worker run test` | 55 passed (3 files) |

### Local integration run

`wrangler dev` against a local D1 with the schema applied, seeded with four
games: three sharing a model/sims/c_puct but differing in leaf parallelism and
virtual loss, and one abandoned game with no `app_version`. Driving the real
frontend modules against that worker:

- `fetchAllGames` reads all four, `truncated: false`;
- with the cap set to exactly 4 rows, `truncated: false`; at 2 rows, `true`;
- `groupGames` returns **three** rows, splitting the batching settings apart;
- two selections issued together settle on the newer one;
- `buildWarning` gives the generic warning for the record with no build and the
  mismatch warning for the other.

The frontend was then built with `VITE_STATS_ENDPOINT` pointed at that worker;
`vite preview` served `/` and `/stats.html?game=smoke-1` (both 200) with the
endpoint inlined into the stats bundle.

**Not run:** the click-through smoke test from the plan (setup screen, starting
as P1/P2, stepping a replay, working the filters). This environment has no
browser, so those twelve steps still need a human at a preview build.
