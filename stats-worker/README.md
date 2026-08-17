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
locally and remotely:

```bash
npx wrangler d1 execute quoridor-stats --local --file schema.sql
```

```bash
npx wrangler d1 execute quoridor-stats --remote --file schema.sql
```

Deploy, and note the `https://quoridor-stats.<subdomain>.workers.dev` URL it
prints:

```bash
npx wrangler deploy
```

That URL goes into `VITE_STATS_ENDPOINT` in `.github/workflows/pages.yml`. It is
public, not a secret. If the play site ever moves to another origin, add it to
`ALLOWED_ORIGINS` in `wrangler.toml` — requests from anywhere else are refused.

## Local development

```bash
npx wrangler dev
```

```bash
curl -X POST http://localhost:8787/v1/games \
  -H 'origin: http://localhost:5173' -H 'content-type: text/plain' \
  -d '{"schema_version":1,"game_id":"demo-1","rev":1,"status":"in_progress","outcome":null,"winner":null,"moves":[12],"action_log":[{"m":12}],"undo_count":0,"duration_ms":0,"client_id":"dev","nick":"unknown","app_version":"dev","model_label":"9x9, 10 walls (v0)","model_id":"b9w10-v0","board_size":9,"max_walls":10,"max_steps":100,"human_player":0,"mcts_n":1000,"c_puct":1.4,"leaf_parallelism":8,"virtual_loss":1,"webgpu_ok":true}'
```

To point a local frontend at it:

```bash
VITE_STATS_ENDPOINT=http://localhost:8787/v1/games npm --prefix ../frontend run dev
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

`schema.sql` is `CREATE TABLE IF NOT EXISTS`, so re-running it against a
database that already has the table does nothing. Adding a column to a live
database means an explicit migration:

```bash
npx wrangler d1 execute quoridor-stats --remote --command "ALTER TABLE game ADD COLUMN nick TEXT NOT NULL DEFAULT 'unknown'"
```

Add the same column to `schema.sql` so a fresh database matches.

## Querying

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
`UPSERT_SQL` against `schema.sql` in an in-memory SQLite (via `node:sqlite`,
Node 22+; it skips on older runtimes) to prove the ordering guard behaves —
stale revisions ignored, finished games never overwritten, undo-shortened move
lists accepted. `index.test.ts` covers routing, CORS, body limits and rate
limiting against a fake D1.
