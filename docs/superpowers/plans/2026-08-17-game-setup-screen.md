# Pre-game setup screen

## Problem

The play page shows a "Setup" drawer beside the board with model, who-plays-first,
MCTS sims, c_puct and leaf parallelism. Those controls stay live for the whole
game, but changing them mid-game does not make sense:

- switching model restarts the game under the player (it has to -- the board size
  can change), which is a surprising thing for a sidebar control to do;
- who-plays-first only takes effect on the *next* game, so the control lies about
  what it does until you press New game;
- the search parameters silently change the opponent's strength half-way through,
  which makes the recorded game meaningless (the stats row carries a single
  `mcts_n` / `c_puct` / `leaf_parallelism` for a game that was played under two).

Meanwhile the stats schema has a `nick` column and the frontend has a
`DEFAULT_NICK` seam wired all the way through, but nothing ever asks the player
for a name, so every row says `unknown`.

## Goal

Move all of it in front of the game: an initial screen that collects nickname,
model, who plays first and the three search parameters, with a button that starts
the game. Once the game is running the setup controls are gone.

## Design

### Screens

`App.svelte` gains a `started` flag and renders one of two things:

- `started === false` -- `SetupScreen.svelte`, a centred card. Nothing has been
  sent to the AI worker or to stats yet.
- `started === true` -- the existing board + `ControlRail`, with no config drawer.

`ConfigDrawer.svelte` is replaced by `SetupScreen.svelte` rather than edited: the
drawer's props are already the right set, but its shape (a 240px rail column) and
its "changing this restarts the game" behaviour both go away.

### Getting back to setup

`ControlRail`'s "New game" button returns to the setup screen instead of
restarting immediately with the same settings. That is the only way back, and it
keeps the previous choices filled in, so replaying the same setup is one extra
click and changing it is possible at all. Leaving a game in progress this way
still reports it as abandoned, exactly as today.

### Starting a game

Today the module body calls `newGame()` on load, so a game is always in flight.
That moves into the Start button: `stats.startGame(...)` and `ai.newGame(...)` are
called once, from the click. The WebGPU probe still runs at load, and now has a
much better chance of having answered before the first stats write -- the player
has to read the screen and press a button first.

### Nickname

- Free text, max 40 chars (`MAX_NICK_LENGTH` in the worker; over-long nicks are
  truncated there anyway, but the input should not let it happen).
- Required: no game starts without one, so every new record carries a real name.
  Whitespace does not count — the button gates on the same trim the reporter and
  the worker apply. `DEFAULT_NICK` survives as a defensive floor on the write
  path, not as a path the UI can take.
- Remembered in `localStorage` under `quoridor.stats.nick` so a returning player
  does not retype it. Stored next to the client id, with the same
  storage-can-throw handling (Safari private mode).
- Read at send time via the existing `nick` seam in `createStatsReporter`, which
  already exists precisely for this and is already tested.

## Changes

1. `frontend/src/lib/stats.ts` -- add `loadNick(storage?)` / `saveNick(nick,
   storage?)` beside `getClientId`. Both swallow storage failures.
2. `frontend/src/lib/statsClient.ts` -- `createAppReporter` takes an options
   object `{ webgpuOk, nick }` instead of a bare `webgpuOk` getter, and applies
   the `DEFAULT_NICK` fallback for a blank name.
3. `frontend/src/lib/SetupScreen.svelte` -- new; replaces `ConfigDrawer.svelte`.
4. `frontend/src/lib/ControlRail.svelte` -- "New game" now means "back to setup";
   only the disabled rule and the hint text need to reflect that.
5. `frontend/src/App.svelte` -- `started` / `nick` state, start and end-game
   handlers, conditional rendering.
6. `frontend/src/lib/stats.test.ts` -- cover `loadNick` / `saveNick`.

## Follow-on: the rules

The site never explained the game. With a setup screen there is now an obvious
place to put that, so `RulesDialog.svelte` holds the rules of **two-player**
Quoridor (the physical game's four-player variant is out of scope — nothing here
plays it) in a native `<dialog>`.

- Opened from a "How to play" link on the setup screen and a button in the rail,
  because the jump and wall rules are exactly what a new player looks up while
  staring at a position. One instance, owned by `App.svelte`.
- `<dialog>` + `showModal()` for Esc-to-close, focus trapping and the backdrop.
  The element's own `close` event drives the parent's flag, so a native close
  cannot leave the two disagreeing.
- Board size, wall count and the step cap come from the selected model, so the
  text describes the game in front of the player and not the standard 9×9.
- Written against what the engine actually enforces (`rust/src/validation.rs`):
  straight jump only when the landing square is free, diagonal only when the
  square behind the opponent is a wall or the board edge, walls may not overlap
  or cross, no wall may leave either player with no path to their goal row, and
  the step cap is a draw.

## Verification

- `npm test` in `frontend/` (vitest) and `npx svelte-check`.
- `npm run build`.
- Drive the dev server in the browser: setup screen renders, Start hides it and
  begins a game, New game comes back with the choices preserved, and the nick
  survives a reload.
