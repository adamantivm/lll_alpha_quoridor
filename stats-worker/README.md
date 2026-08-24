# quoridor-stats worker

Collects a record of every game played on the static site into a Cloudflare D1
database, so we can see how many games get played, how often the AI wins, and
replay any individual game.

The frontend writes after **every move**, which means a game that is abandoned
mid-play is still replayable up to the position the player walked away from —
usually the interesting part, since people tend to leave once the result is
obvious.

## Why Cloudflare

- No inactivity pause. A Supabase free-tier project sleeps after about a week
  without traffic and needs a manual restore; at a handful of games a day that
  is a real hazard.
- The DB credential stays server-side. Writing straight from the browser would
  ship a write token in the bundle.
- IP, user agent and country come from the request rather than the payload.
- Free-tier headroom: 100k worker requests and 100k D1 row writes per day,
  against a few hundred writes on a busy day here.

## One-time setup

```bash
cd stats-worker
npm install
npx wrangler login
npx wrangler d1 create quoridor-stats
```

Copy the printed `database_id` into `wrangler.toml`, then create the table
locally and remotely by applying the migrations:

```bash
npx wrangler d1 migrations apply quoridor-stats --local
```

```bash
npx wrangler d1 migrations apply quoridor-stats --remote
```

The schema lives in `migrations/`, and `migrations/0001_baseline.sql` is the
table as it stands. It is idempotent (`CREATE TABLE IF NOT EXISTS`), so applying
it to a database that already has the table does nothing but record it as
applied — which is how the existing production database was adopted rather than
rebuilt. Schema changes from here on are new numbered files:

```bash
npx wrangler d1 migrations create quoridor-stats "add the thing"
```

CI applies them before deploying the code (see `.github/workflows/stats-worker-deploy.yml`).
Do not hand-write `ALTER TABLE` against the remote database any more: a change
that is not in `migrations/` will be missing from every database created later.

## Deploying

CI deploys this Worker. `.github/workflows/stats-worker-deploy.yml` runs on a
push to `main` that touches `stats-worker/`, applies any pending D1 migrations,
deploys, and then asks the running Worker which commit it is serving.

The deployed URL lives in the **`STATS_ENDPOINT` repository variable**, as the
full `https://.../v1/games` URL — the smoke test strips that suffix to find the
Worker's base and check `/v1/health`, and `pages.yml` passes the same variable
to the frontend build as `VITE_STATS_ENDPOINT`. It is public, not a secret. If
the play site ever moves to another origin, add it to `ALLOWED_ORIGINS` in
`wrangler.toml` — requests from anywhere else get no CORS headers and are
refused.

The Cloudflare API token is a secret of the **`stats-worker` environment**, not
of the repository. Only a job that declares `environment: stats-worker` can read
it, and declaring it is what makes the job wait for a reviewer — so deleting the
`environment:` line to skip the approval also deletes the credential. The
environment is additionally pinned to the `main` branch.

Approving a deploy is a separate grant from merging code:

| To let someone… | Give them… |
|---|---|
| merge to `main` | collaborator access with **Write** |
| approve a deploy | a slot in the environment's **Required reviewers** |

Either without the other is fine. On a public repository a reviewer needs only
read access, so the deploy button can be handed out without handing out the code.

`workflow_dispatch` offers two rungs that do not touch production: `whoami`
(checks the token, lists the applied migrations, and verifies the live table
still matches `migrations/0001_baseline.sql`) and `versions-upload` (a real
upload that serves no traffic and prints a preview URL).

### Rollback

```bash
npx wrangler rollback
```

Or pin a specific earlier version:

```bash
npx wrangler versions list
npx wrangler versions deploy <version-id>@100%
```

Neither reverts a migration. D1 migrations only go forward: undoing a schema
change means writing the next migration.

## Local development

```bash
npx wrangler dev
```

```bash
curl -X POST http://localhost:8787/v1/games \
  -H 'origin: http://localhost:5173' -H 'content-type: text/plain' \
  -d '{"schema_version":1,"game_id":"demo-1","rev":1,"status":"in_progress","outcome":null,"winner":null,"moves":[12],"action_log":[{"m":12}],"undo_count":0,"duration_ms":0,"client_id":"dev","nick":"unknown","app_version":"dev","model_label":"9x9, 10 walls (v0)","model_id":"b9w10-v0","board_size":9,"max_walls":10,"max_steps":100,"human_player":0,"mcts_n":1000,"c_puct":1.4,"leaf_parallelism":8,"virtual_loss":1,"webgpu_ok":true}'
```

Read it back:

```bash
curl -s -H 'origin: http://localhost:4173' 'http://localhost:8787/v1/games?limit=5'
```

To point a local frontend at it (`run dev` is broken for that app — see
`frontend/README.md` — so build and preview, on the port the allowlist expects):

```bash
VITE_STATS_ENDPOINT=http://localhost:8787/v1/games npm --prefix ../frontend run build && npm --prefix ../frontend run preview
```

## API

`POST /v1/games` — upserts one game record. The client sends the **whole**
record on every write rather than a start payload followed by deltas: it costs a
few hundred bytes and means the row is complete even if the first POST of a game
is the one that gets dropped.

Writes are ordered by a client-side `rev` counter. The database accepts a write
only if its `rev` beats the stored one and the game is not already `finished`,
so a late `pagehide` beacon cannot overwrite a win, and a retry that overtakes
its predecessor is dropped. This is a `WHERE` clause on the `ON CONFLICT` —
see `src/sql.ts`.

`GET /v1/games?limit=&cursor=&status=` — the recorded games, newest first,
without the move lists. Answers `{"games": [...], "next_cursor": "..."}`;
`next_cursor` is null once there is nothing left. `limit` defaults to 200 and
caps at 500. A `limit`, `cursor` or `status` the worker cannot use is a 400
rather than a silent default — a caller paginating with an unparseable cursor
would otherwise loop over page one forever.

Pagination is keyset on the `(started_at, game_id)` pair, not `OFFSET`.
`started_at` is a server timestamp with no uniqueness guarantee, so a plain
`started_at <` cursor would cost us one of two games recorded in the same
millisecond.

**`ip` and `user_agent` are not in the response, and should stay out of it.**
The stats page is public, no statistic on it needs either, and both are
collected from the request for abuse handling only. `country` is exposed.

`GET /v1/games/{game_id}` — one game, with `moves` and `action_log` added, which
is everything the replay viewer needs. 404 if there is no such game.

Reads share the write path's origin allowlist and per-IP rate limit, and carry
`cache-control: public, max-age=30`.

`GET /v1/health` — liveness.

### Two move columns

- `moves` is the current history, exactly what the wasm engine reports. It
  shrinks when the player undoes, and always replays cleanly to the position on
  screen.
- `action_log` is append-only: `[{"m":12},{"m":40},{"u":2},{"m":17}]`, where `m`
  is an action index played and `u` is a takeback of *n* plies. This is what
  answers "did they try a move and take it back?".

Action indices are the same flat encoding the Python and Rust code use: `[0,
N*N)` is a pawn move to `row*N+col`, then `(N-1)²` vertical wall placements,
then `(N-1)²` horizontal ones.

### The nick

`nick` is the player's chosen name. The setup screen requires one before it will
start a game, and remembers it in the browser for the next visit, so new records
carry a real name; `unknown` is what older rows say. Validation stays
deliberately forgiving — absent, blank or over-long values fall back or get
trimmed instead of costing us the game record, and control characters are
stripped so a nick stays one printable line. It is also updatable, unlike the
rest of the setup fields: a name chosen part-way through a game attaches to that
game, not just the next one.

### Changing the schema

The `nick` and `preset` columns were originally added by hand with
`ALTER TABLE`; both are now part of `migrations/0001_baseline.sql`. A new
column goes in a new migration file instead:

```bash
npx wrangler d1 migrations create quoridor-stats "add the thing"
```

## Querying

The site's own stats page (`frontend/stats.html`, deployed at
`/stats.html`) reads both endpoints above: win rates grouped by model, MCTS sims
and c_puct, and a replay of any recorded game. For anything it does not show,
query the database directly:

```bash
npx wrangler d1 execute quoridor-stats --remote --command "SELECT date(started_at) d, count(*) n FROM game GROUP BY d ORDER BY d DESC LIMIT 14"
```

Useful ones:

```sql
-- AI win rate per model, finished games only
SELECT model_label, count(*) n, round(avg(outcome = 'ai_win'), 3) ai_win_rate
FROM game WHERE status = 'finished' GROUP BY 1;

-- ... and excluding games where the human took a move back
SELECT model_label, count(*) n, round(avg(outcome = 'ai_win'), 3) ai_win_rate
FROM game WHERE status = 'finished' AND undo_count = 0 GROUP BY 1;

-- how many games are finished vs walked away from
SELECT status, count(*) FROM game GROUP BY status;

-- where abandoned games got to
SELECT move_count, count(*) FROM game WHERE status <> 'finished' GROUP BY 1 ORDER BY 1;

-- everything needed to replay one game
SELECT board_size, max_walls, max_steps, human_player, moves FROM game WHERE game_id = '...';

-- how each player is doing
SELECT nick, count(*) n, round(avg(outcome = 'human_win'), 3) win_rate
FROM game WHERE status = 'finished' GROUP BY 1 ORDER BY n DESC;
```

## Tests

```bash
npm test
```

`record.test.ts` covers payload validation. `sql.test.ts` runs the real
`UPSERT_SQL` against `migrations/0001_baseline.sql` in an in-memory SQLite
(via `node:sqlite`, Node 22+; it skips on older runtimes) to prove the
ordering guard behaves — stale revisions ignored, finished games never
overwritten, undo-shortened move lists accepted. `index.test.ts` covers
routing, CORS, body limits and rate limiting against a fake D1.
