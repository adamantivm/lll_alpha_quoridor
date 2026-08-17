# Pre-game setup screen

Moves the model / who-plays-first / MCTS settings out of the sidebar and in
front of the game, and finally asks the player for a nickname.

Plan: [docs/superpowers/plans/2026-08-17-game-setup-screen.md](../plans/2026-08-17-game-setup-screen.md)

## Why

The "Setup" drawer sat beside the board and stayed live for the whole game, but
none of its controls actually mean anything mid-game:

- **Model** had to restart the game to change (the board size can change with
  it), which is a surprising thing for a sidebar control to do to a game in
  progress.
- **You play first / second** only took effect on the *next* game, so the
  control misrepresented itself until you pressed New game.
- **sims / c_puct / leaf parallelism** silently changed the opponent's strength
  half-way through. That also corrupted the record: the stats row carries one
  `mcts_n`, `c_puct` and `leaf_parallelism` for a game that may have been played
  under several.

Separately, the stats schema has carried a `nick` column, the worker has
validated it, and the frontend has had a `nick` seam wired through
`createStatsReporter` — but nothing ever asked, so every row said `unknown`.

## What changed

**A setup screen before the game.** `SetupScreen.svelte` (replacing
`ConfigDrawer.svelte`) is a centred card with nickname, model, who plays first
and the three search parameters, plus a **Start game** button. Nothing is sent to
the AI worker or to stats until it is pressed — previously a game was started
from the module body on page load.

**Settings are fixed once a game is running.** The rail keeps a small read-only
"This game" summary (model, side, search parameters), since the drawer was the
only place that showed what you were playing against.

**New game means back to setup.** It is the way back to the controls, and it
keeps the previous choices filled in, so replaying the same setup is one extra
click. Leaving a game in progress this way still reports it abandoned, as before.

**Nicknames.** Optional free text, capped at the worker's `MAX_NICK_LENGTH` of
40. Blank means anonymous and still records `unknown`. The name is remembered in
`localStorage` (`quoridor.stats.nick`, beside the client id, with the same
storage-can-throw handling for Safari private mode) so a returning player does
not retype it. It is read at send time through the existing reporter seam.

**Dead code removed.** `setParams` on the AI client and its handler in the worker
existed only to push mid-game parameter edits, which can no longer happen.

## Files

| File | Change |
| --- | --- |
| `frontend/src/lib/SetupScreen.svelte` | New; replaces `ConfigDrawer.svelte` |
| `frontend/src/App.svelte` | `started` / `nick` state, start and back-to-setup handlers, conditional render |
| `frontend/src/lib/ControlRail.svelte` | Read-only setup summary; New game goes back to setup |
| `frontend/src/lib/stats.ts` | `loadNick` / `saveNick`, `MAX_NICK_LENGTH` |
| `frontend/src/lib/statsClient.ts` | `createAppReporter({ webgpuOk, nick })` |
| `frontend/src/lib/aiClient.ts`, `frontend/src/ai.worker.ts` | Drop `setParams` |
| `frontend/src/lib/stats.test.ts` | Cover the nick storage helpers |
| `README.md`, `frontend/README.md`, `stats-worker/README.md` | Describe the setup screen; the nick is no longer "nothing asks yet" |

## Verification

- `npm --prefix frontend run test` — 57 passed (5 new, covering nick storage:
  round-trip, blank-when-unset, trim/truncate, clearing, and hostile storage).
- `npx svelte-check` — 0 errors (1 pre-existing a11y warning in `Board.svelte`).
- `npm --prefix frontend run build` and `run check:build` — clean.
- Driven in a real browser against `npm run preview`:
  - setup screen renders and Start hides it;
  - starting as P2 has the AI open (Moves: 1) and play proceeds normally;
  - New game returns to setup with nickname, model, side and sims preserved;
  - the nickname survives a page reload, the rest resets to defaults;
  - switching model updates the board hint and loads that model's search
    defaults, and the 5×5 model then loads and plays;
  - no console errors; the card layout holds at 375px wide.
