# Pre-game setup screen

Moves the model / who-plays-first / MCTS settings out of the sidebar and in
front of the game, asks the player for a nickname, and adds the rules of the
game — which the site has never actually explained.

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

**Nicknames.** Required: **Start game** stays disabled, with the reason under it,
until one is entered, and whitespace does not count — the button gates on the
same trim the reporter and the worker apply, so what unlocks it is what would be
recorded. Capped at the worker's `MAX_NICK_LENGTH` of 40. The name is remembered
in `localStorage` (`quoridor.stats.nick`, beside the client id, with the same
storage-can-throw handling for Safari private mode) so a returning player does
not retype it, and it is read at send time through the existing reporter seam.
`DEFAULT_NICK` survives as a defensive floor on the write path rather than a
path the UI can take.

**The rules of the game**, which the site never explained. `RulesDialog.svelte`
covers two-player Quoridor — winning, the move-or-wall turn, jumps, walls, the
never-seal-anyone-in rule and the step-cap draw — written against what
`rust/src/validation.rs` actually enforces rather than the boxed rules, and using
the selected model's board size, wall count and step cap so it describes the game
in front of the player. (The physical game's four-player variant is out of scope;
nothing here plays it.) It opens from a *How to play* link on the setup screen
and a button in the rail, since the jump and wall rules are exactly what a new
player looks up mid-position. A native `<dialog>` gives Esc-to-close, focus
trapping and the backdrop; its own `close` event drives the parent's flag, so a
native close cannot leave the two disagreeing.

**The search settings explain themselves.** Each slider now carries a line saying
what it does: sims is the strength dial, `c_puct` trades depth against breadth
(and moving it far from the tuned default plays worse rather than faster), and
leaf parallelism is faster because the GPU prefers a batch — at the cost of the
search guessing about the positions still in flight, so the AI may play slightly
worse.

**Dead code removed.** `setParams` on the AI client and its handler in the worker
existed only to push mid-game parameter edits, which can no longer happen.

## Files

| File | Change |
| --- | --- |
| `frontend/src/lib/SetupScreen.svelte` | New; replaces `ConfigDrawer.svelte` |
| `frontend/src/lib/RulesDialog.svelte` | New; the two-player rules |
| `frontend/src/App.svelte` | `started` / `nick` / `showRules` state, start and back-to-setup handlers, conditional render |
| `frontend/src/lib/ControlRail.svelte` | Read-only setup summary; New game goes back to setup; How to play |
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
  - Start is disabled with no nickname and with whitespace only, and enables on
    a real one;
  - starting as P2 has the AI open (Moves: 1) and play proceeds normally;
  - New game returns to setup with nickname, model, side and sims preserved;
  - the nickname survives a page reload, the rest resets to defaults;
  - switching model updates the board hint and loads that model's search
    defaults, and the 5×5 model then loads and plays;
  - the rules dialog opens from both entry points, closes by button, reopens
    scrolled back to the top, and picks up the selected model's numbers (10
    walls / 100 moves on 9×9, 2 walls / 50 moves on 5×5);
  - no console errors; setup card and dialog both hold up at 375px wide.
