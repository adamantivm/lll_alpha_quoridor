-- Game records for the static play site. One row per game, created when the
-- game starts and rewritten after every move, so an abandoned game is still
-- replayable up to the position the player walked away from.
--
-- Apply with:
--   npx wrangler d1 execute quoridor-stats --local  --file schema.sql
--   npx wrangler d1 execute quoridor-stats --remote --file schema.sql

CREATE TABLE IF NOT EXISTS game (
  game_id          TEXT PRIMARY KEY,  -- crypto.randomUUID() from the browser
  started_at       TEXT NOT NULL,     -- server ISO-8601; client clocks are not trusted
  updated_at       TEXT NOT NULL,     -- server time of the most recent accepted write
  status           TEXT NOT NULL,     -- 'in_progress' | 'finished' | 'abandoned'
  outcome          TEXT,              -- 'human_win' | 'ai_win' | 'draw'; NULL until finished
  winner           INTEGER,           -- NULL on a draw or while unfinished
  moves            TEXT NOT NULL,     -- JSON array of action indices: current, replayable history
  move_count       INTEGER NOT NULL,
  action_log       TEXT NOT NULL,     -- JSON: every action in order, undos included
  undo_count       INTEGER NOT NULL,  -- games with undos are not clean AI-strength samples
  rev              INTEGER NOT NULL,  -- client write counter; the ordering guard
  duration_ms      INTEGER NOT NULL,
  client_id        TEXT NOT NULL,     -- anonymous random id, persisted in localStorage
  nick             TEXT NOT NULL DEFAULT 'unknown',  -- player's chosen name; 'unknown' until the UI asks
  schema_version   INTEGER NOT NULL,
  app_version      TEXT,              -- git sha, injected at build time
  model_label      TEXT NOT NULL,     -- exactly what the picker shows, e.g. "9x9, 10 walls (v0)"
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
  -- Captured server-side from the request, never trusted from the client.
  ip               TEXT,
  user_agent       TEXT,
  country          TEXT
);

CREATE INDEX IF NOT EXISTS idx_game_started ON game(started_at);
CREATE INDEX IF NOT EXISTS idx_game_model ON game(model_label);
