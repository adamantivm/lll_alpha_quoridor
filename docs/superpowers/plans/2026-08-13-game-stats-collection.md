# Game stats collection for the static Quoridor site

Results: `docs/superpowers/results/2026-08-13-game-stats-collection-results.md`

## Context

The playable site at `https://adamantivm.github.io/lll_alpha_quoridor/` is fully static: the
Svelte frontend, the Rust/WASM rules engine and the ONNX models all run in the browser, and
there is **no persistence of any kind** — no `localStorage`, no `fetch` beyond static assets,
no backend. Game state dies with the tab.

We want to know how many games get played, how often the AI wins, and be able to reproduce any
individual game later — **including games that are abandoned**, since players are likely to
walk away exactly when the outcome becomes obvious, and seeing the position they walked away
from is part of what we want to learn. Volume is tiny: ~10 games/day while we demo it, ~2-3/day
afterwards. The storage has to be hosted (no self-hosting).

**Chosen approach:** a small Cloudflare Worker in front of a Cloudflare **D1** database
(managed SQLite). One row per game, created at game start and updated after **every move**, so
a game is replayable up to its last move whether it was won, lost, drawn or abandoned mid-play.

### Why D1 + Worker over the alternatives

- **No inactivity pause.** Supabase's free tier pauses a project after ~1 week without API
  traffic and needs a manual restore; at 2-3 games/day that is a live hazard whenever interest
  dips. Cloudflare has no such behaviour.
- **Credentials stay server-side.** Writing straight from the browser (Supabase anon key,
  Firestore client SDK) publishes a write token in the bundle and pushes all validation into
  RLS policies / security rules. The Worker keeps the DB binding private, validates payloads,
  locks CORS to the Pages origin, and is the natural place to capture IP / user agent, which
  the client cannot report about itself.
- **Headroom.** Workers 100k requests/day, D1 100k row writes/day and 5 GB. Per-move writes on
  a 60-move game make ~60 writes; at 10 games/day that is ~600/day, under 1% of the limit.
- **SQL.** Stats queries stay one-liners, unlike Firestore's aggregation story.

Cost of the choice: one extra deploy target (`wrangler`), done manually and documented — not
wired into CI in this change.

## Data model

A single `game` table, keyed by a client-generated UUID. `winner` / `human_player` use the same
0-based player encoding as `StateView` (`frontend/src/lib/types.ts`). The `moves` array is the
same flat list of action indices that `src/plugins/arena_yaml_recorder.py` already records for
arena games, so replay tooling stays conceptually compatible.

```sql
CREATE TABLE game (
  game_id          TEXT PRIMARY KEY,  -- crypto.randomUUID() from the browser
  started_at       TEXT NOT NULL,     -- server ISO-8601; client clocks are not trusted
  updated_at       TEXT NOT NULL,     -- server time of the most recent write
  status           TEXT NOT NULL,     -- 'in_progress' | 'finished' | 'abandoned'
  outcome          TEXT,              -- 'human_win' | 'ai_win' | 'draw'; NULL until finished
  winner           INTEGER,           -- NULL on a draw or while unfinished
  moves            TEXT NOT NULL,     -- JSON array of action indices: the current, replayable history
  move_count       INTEGER NOT NULL,
  action_log       TEXT NOT NULL,     -- JSON: every action in order, undos included (see below)
  undo_count       INTEGER NOT NULL,  -- games with undos are not clean AI-strength samples
  rev              INTEGER NOT NULL,  -- client write counter; the ordering guard
  duration_ms      INTEGER NOT NULL,
  client_id        TEXT NOT NULL,     -- anonymous random id, persisted in localStorage
  nick             TEXT NOT NULL DEFAULT 'unknown',  -- player's name; 'unknown' until the UI asks
  schema_version   INTEGER NOT NULL,
  app_version      TEXT,              -- git sha, injected at build time
  model_label      TEXT NOT NULL,     -- exactly what the picker shows, e.g. "9×9, 10 walls (v0)"
  model_id         TEXT NOT NULL,     -- catalogue id, e.g. "b9w10-v0"
  board_size       INTEGER NOT NULL,
  max_walls        INTEGER NOT NULL,
  max_steps        INTEGER NOT NULL,
  human_player     INTEGER NOT NULL,
  mcts_n           INTEGER NOT NULL,
  c_puct           REAL    NOT NULL,
  leaf_parallelism INTEGER NOT NULL,
  virtual_loss     REAL    NOT NULL,
  webgpu_ok        INTEGER,           -- 1/0 from checkWebGpu(); affects search speed
  -- captured server-side from request headers, not reported by the client
  ip               TEXT,
  user_agent       TEXT,
  country          TEXT               -- request.cf.country
);

CREATE INDEX idx_game_started ON game(started_at);
CREATE INDEX idx_game_model   ON game(model_label);
```

The model is identified by its **display label** — the string in the picker — taken from
`meta.json` via `ModelEntry.label` (`frontend/src/lib/models.ts`), with the catalogue id stored
alongside since it's already to hand. Worth knowing: neither is a content identifier, so if a
model is ever retrained and shipped under the same id, older and newer games will be
indistinguishable in the data. Bumping the version in the label (`v0` → `v1`) when weights
change is enough to keep this honest, and `CONTRIBUTING.md`'s "Adding a play model" section is
where I'll note that.

IP, user agent and country are read from the request in the Worker (`CF-Connecting-IP`,
`User-Agent`, `request.cf.country`) rather than trusted from the client.

Note: onnxruntime does not report which execution provider actually won the
`["webgpu", "wasm"]` race, so the record stores `webgpu_ok` from the existing `checkWebGpu()`
in `frontend/src/lib/webgpu.ts` rather than claiming to know the EP.

### Undo, and why there are two move columns

`StateView.move_history` is the *current* history: `Game.undo(n)` replays from the initial
state, so undone moves vanish from it. Keeping only that column would silently lose the fact
that a move was played and taken back — and a naive "the move list may never shrink" guard is
worse than useless, since after an undo the stored list would be a splice of two different
games that no longer replays.

So the row carries both:

- **`moves`** — the true current history, exactly `view.move_history`. It shrinks on undo and
  always replays cleanly to the position on screen.
- **`action_log`** — append-only, never rewritten: `[{"m":12},{"m":40},{"u":2},{"m":17},…]`
  where `m` is an action index played and `u` is a takeback of *n* plies. This is what answers
  "did they try a move and undo it?".

Ordering is guarded by a monotonic `rev` counter the client increments on every write: the
server accepts a write only if `rev` is greater than the stored one (and never overwrites a
`finished` game). That is what makes an out-of-order or late-arriving beacon harmless, and
unlike a length comparison it stays correct when the move list legitimately shrinks.

## Capturing abandoned games

The move list is written **after every move**, so the record is never more than one move behind
what the player saw. On top of that:

- **`pagehide` / `visibilitychange → hidden`** via `navigator.sendBeacon` marks the game
  `abandoned` as the tab closes (`sendBeacon` survives unload where `fetch` does not).
- **Pressing *New game*** (or switching model) with a game in progress marks it `abandoned`
  first — the common case for "the outcome was obvious".
- A game whose last write left it `in_progress` was abandoned without either signal firing
  (crash, battery, mobile background kill); the moves are still there.

The server never regresses a game: an update is rejected unless its `rev` beats the stored one,
and a `finished` game is never overwritten. A late-arriving beacon after a win cannot corrupt
the record.

## Implementation

### 1. `stats-worker/` (new top-level directory)

- `wrangler.toml` — worker name `quoridor-stats`, D1 binding `DB`, a Rate Limiting binding.
- `schema.sql` — the DDL above.
- `src/index.ts`:
  - `POST /v1/games` — upsert. Body carries `game_id` plus the full start metadata on the first
    call and just the progress fields afterwards. `GET /v1/health`. No read endpoints —
    querying is via `wrangler d1 execute` (see Verification).
  - `OPTIONS` preflight; `Access-Control-Allow-Origin` restricted to
    `https://adamantivm.github.io` plus `http://localhost:5173` for dev.
  - Reject bodies over 64 KB before parsing (a 100-move game's move list is well under 1 KB).
  - `validate()` as a pure exported function (unit-testable without Miniflare): types, ranges,
    `moves` entries within `[0, N*N + 2*(N-1)^2)`, `moves.length <= max_steps`, `action_log`
    entry shapes, enum status and outcome, string length caps on `model_label` / `user_agent`.
  - The ordering rule expressed in the `ON CONFLICT DO UPDATE ... WHERE excluded.rev > game.rev
    AND game.status <> 'finished'` clause, so it is enforced atomically rather than by
    read-then-write.
  - Per-IP rate limit via the Workers Rate Limiting binding — needed because writes are now
    per-move and the endpoint is public.
  - Always returns quickly and never returns a body the client acts on; failures are logged.
- `src/index.test.ts` — vitest over `validate()`, the no-regression logic, header capture and
  CORS/size handling.
- `README.md` — one-time setup (`wrangler d1 create`, apply `schema.sql` locally and remotely,
  `wrangler deploy`) and the query cookbook.

### 2. Frontend reporter — `frontend/src/lib/stats.ts` (new)

Framework-free and injectable so it unit-tests cleanly, matching how `models.ts` /
`boardGrid.ts` keep pure logic out of components:

- `createStatsReporter({ endpoint, appVersion, clientId, fetchImpl, beaconImpl })` →
  `{ startGame(meta), recordMoves(moves), finishGame(outcome, winner), abandonGame() }`.
- Holds the current game id, start time, `rev`, the last-seen move list and the `action_log`.
- **`recordMoves(moves)` derives the log by diffing** against the previous list: take the
  common prefix length *p*; if *p* < previous length append `{u: prev.length - p}`; then append
  `{m: idx}` for each entry after *p*. Nothing to post when the list is unchanged, so it is
  safe (and cheap) to call on every state push, and undos need no separate call site — the
  worker's `undo(2)` replay shows up as one `u` entry followed by the replacement moves.
- Fire-and-forget `fetch(..., { keepalive: true })`, `navigator.sendBeacon` on the unload path;
  every rejection swallowed. A stats outage must never affect play.
- No-op when `endpoint` is empty — that is the dev default, so local play writes nothing.
- `getClientId()` — random UUID in `localStorage` under `quoridor.stats.client_id`, wrapped in
  try/catch (Safari private mode throws).

### 3. Wiring — `frontend/src/App.svelte`

- `newGame()`: if a game is in progress, `abandonGame()` first; then mint
  `crypto.randomUUID()`, reset the undo counter, and `startGame({...})` from `selected`
  (including `selected.label`) + `params` + `humanPlayer` + `gpu?.ok`.
- `ai.onState`: `recordMoves(view.move_history)` on every state push, and `finishGame()` once
  when `view.winner != null` **or** `view.completed_steps >= view.max_steps` with a null
  winner — the step-cap draw, which the Rust side treats as game-over.
- `onundo`: increment the undo counter alongside `ai.undo(2)`. The shortened history arrives
  through the normal state push and the reporter's diff turns it into a `u` entry, so no other
  wiring is needed.
- One `pagehide` listener registered at module scope calling `abandonGame()`.

Pre-existing, **out of scope**: on a step-cap draw the UI keeps showing "Your move" while the
worker rejects moves with "game is already over". I'll note it in the PR, not fix it here.

### 4. Build/config plumbing

- `frontend/vite.config.ts`: `define: { __APP_VERSION__: JSON.stringify(process.env.GITHUB_SHA
  ?? "dev") }`.
- `VITE_STATS_ENDPOINT` set as a plain env value in `.github/workflows/pages.yml` (a public
  URL, not a secret); unset everywhere else, so CI builds and local dev report nothing.
- `scripts/check-build.mjs` needs no change — it only forbids root-absolute `/models/` and
  `/ort/` literals; an absolute `https://` endpoint is fine.
- `README.md`: a note that games are recorded (moves, settings, IP and browser) — no in-app UI,
  per the chosen approach. `CONTRIBUTING.md`: bump the version in a model's label when its
  weights change, since the label is how games are attributed to a model.

### Commits (branch `vibe/game-stats-collection`)

1. `vibe: add stats worker and D1 schema`
2. `vibe: report game stats from the browser`
3. formatting/lint-only commit, per AGENTS.md

Plus the results markdown for the PR body.

## Verification

1. `npm --prefix frontend test` — new `stats.test.ts` covers payload shape, the disabled no-op,
   one write per move and none when the list is unchanged, the undo diff (play 4, undo 2, play
   2 → log `m m m m u m m` with a 4-entry `moves`), single-fire on finish, abandon-then-start
   ordering, and swallowed fetch failures.
2. `npm --prefix stats-worker test` — validation, the `rev` ordering rule, refusal to overwrite
   a finished game, header capture, CORS and body size rejection.
3. `npx wrangler dev` in `stats-worker/` against a local D1, then `curl` a start, several move
   updates, a stale-`rev` update (must be ignored) and a finish; confirm with
   `npx wrangler d1 execute quoridor-stats --local --command "select * from game"`.
4. `npm --prefix frontend run build && npm --prefix frontend run check:build`.
5. End-to-end: `wrangler deploy`, then `VITE_STATS_ENDPOINT=<url> npm run dev` and play
   (a) a 5×5 game to a win, (b) one to the step cap, (c) one abandoned by pressing *New game*
   mid-play, (d) one abandoned by closing the tab, (e) one with an undo in the middle — its
   `moves` must replay to the final position while `action_log` still shows the taken-back
   move. Read the rows back with
   `npx wrangler d1 execute quoridor-stats --remote --command "..."`; each must carry a `moves`
   array that replays to the position reached, the right `status`, and a populated
   `model_label`, `ip` and `user_agent`.
6. Sample queries for the worker README:
   - games/day: `select date(started_at) d, count(*) from game group by d;`
   - AI win rate by model: `select model_label, avg(outcome='ai_win') from game where status='finished' group by 1;`
   - abandonment rate: `select status, count(*) from game group by status;`
   - clean AI win rate (no takebacks):
     `select model_label, avg(outcome='ai_win') from game where status='finished' and undo_count=0 group by 1;`
   - replay one game: `select moves from game where game_id='...';`

Sources: [Supabase pricing](https://supabase.com/pricing), [Supabase free tier limits](https://www.itpathsolutions.com/supabase-free-tier-limits)
