# Follow-up cleanup after PRs #11 and #12

Implementation plan for `claude-code-followup-plan.md`. Toy project: fix the
listed correctness issues, add the missing regression tests, introduce no new
abstractions beyond what a test needs to reach.

## 1. Stale replay selection requests

`StatsApp.svelte` awaits `fetchGame()` inline, so a slow request for game A can
land after a fast one for game B and overwrite it.

- New `frontend/src/lib/selectGame.ts`: `createGameSelector(load, sink)` keeps a
  monotonically increasing sequence number and drops any result — success or
  error — that is not the newest. ~20 lines, specific to this page, no general
  request manager.
- `StatsApp.svelte` keeps the URL/`selectedId` bookkeeping and delegates the
  fetch to the selector.
- `selectGame.test.ts`: out-of-order resolution keeps B; a stale error cannot
  replace B's state.

## 2. Grouping semantics

Group by every search parameter that can change how the AI plays.

- `groupKeyOf` gains `leaf_parallelism` and `virtual_loss`.
- `GroupStats.leafParallelism` / `.virtualLoss` become scalars (the group can no
  longer hold more than one value each), plus a sort tiebreak on them.
- `SummaryTable.svelte` shows both columns; the stats page heading stops saying
  "by model, sims and c_puct".
- Tests: changing any of the five dimensions splits the group.

## 3. Exact row-cap truncation

The worker returns a cursor whenever a page comes back full, so exactly
`MAX_ROWS` rows currently report as truncated.

- When the budget runs out and the server handed back a cursor, `fetchAllGames`
  makes one `limit=1` probe: `truncated` is true only if it returns a row.
- Test fake is corrected to mirror the worker (cursor on any full page) and
  covers fewer / exactly / more than the cap.

## 4 + 5. Game lifecycle

`App.svelte` calls `stats.startGame()` and then `ai.newGame()`; if the worker
never produces a state, the stats record stays `in_progress` forever. The
lifecycle is also untested because it lives inside a component.

- New `frontend/src/lib/session.ts`: a small non-reactive orchestrator holding
  the AI client, the stats reporter and one flag ("has a playable state
  arrived"). It exposes `start`, `handleState`, `handleError`, `leave` and the
  pure helpers `statsMetaFor` / `aiRequestFor` / `awaitingHuman`.
- `handleError` before any state has arrived abandons the pending stats game
  (option B of the plan — no change to the ordering of the two calls).
- `App.svelte` keeps all Svelte state and delegates the orchestration.
- `session.test.ts`: nothing sent before Start; one init on Start with matching
  stats/AI metadata; setup edits touch neither; failed init abandons; New Game
  abandons once and only for unfinished games; human-as-P2 passes
  `humanPlayer: 1` and the first state already carries the AI's opening move.

## 6. Replay build-compatibility warning

- `replay.ts` gains a pure `buildWarning(recorded, current)`: null when the
  builds match, a "rules may have changed" note when they differ, and a generic
  note when the record has no build. Replay is never blocked.
- `Replay.svelte` renders it above the board.

## 7. Checks

`npm --prefix frontend run test | build | check:build`, `svelte-check
--threshold error`, `npm --prefix stats-worker run typecheck | test`, plus a
local preview smoke test of the setup → play → stats → replay flow.

## Commits

1. fix stale replay selection
2. group stats by every search parameter
3. fix truncation at exactly the row cap
4. abandon stats on failed game start (session extraction + tests)
5. warn when replaying another build
