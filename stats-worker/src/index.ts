/**
 * Collects game records from the static play site into D1, and serves them back
 * to the stats page.
 *
 * POST /v1/games upserts the whole record. The client writes after every move,
 * so a game abandoned mid-play is still replayable up to the position the player
 * walked away from. GET /v1/games lists the records and GET /v1/games/{id} adds
 * the move list, which is all the replay viewer needs.
 */
import { MAX_BODY_BYTES, validate } from "./record";
import {
  GAME_SQL,
  UPSERT_SQL,
  bindValues,
  encodeCursor,
  listStatement,
  parseListQuery,
  rowToDetail,
  rowToSummary,
} from "./sql";

/**
 * The commit this Worker was built from, substituted at deploy time by
 * `wrangler deploy --define BUILD_SHA:'"<sha>"'`. `--define` and not `--var`:
 * `wrangler deploy` deletes every var not named on the command line, so a
 * `--var` here would silently drop ALLOWED_ORIGINS and break CORS site-wide.
 *
 * `typeof` rather than a bare read: nothing substitutes the identifier in
 * `wrangler dev` or under vitest, and reading an undeclared global there would
 * throw. esbuild rewrites the whole expression when the define is present.
 */
declare const BUILD_SHA: string | undefined;
const VERSION = typeof BUILD_SHA === "undefined" ? "dev" : BUILD_SHA;

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
  // Optional because a rate limit binding is not always materialised in local
  // dev, and losing the limiter there must not take the endpoint down with it.
  RATE_LIMIT?: RateLimit;
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A game id as the client generates it: crypto.randomUUID(), at most 64 chars. */
const GAME_PATH = /^\/v1\/games\/([A-Za-z0-9_-]{1,64})$/;

/**
 * Reads are cacheable for half a minute. The stats page fetches every page of
 * the list on load, so a reload -- or two people looking at once -- should not
 * cost a full scan each time.
 */
const READ_CACHE = { "cache-control": "public, max-age=30" };

/** GET /v1/games: newest first, keyset-paginated, without the move lists. */
async function handleList(
  url: URL,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const parsed = parseListQuery(url.searchParams);
  if (!parsed.ok) return json(400, { error: parsed.error }, cors);

  const { sql, binds } = listStatement(parsed.query);
  let rows: Record<string, unknown>[];
  try {
    const result = await env.DB.prepare(sql).bind(...binds).all<Record<string, unknown>>();
    rows = result.results ?? [];
  } catch (err) {
    console.error("list failed:", err);
    return json(500, { error: "read failed" }, cors);
  }

  const games = rows.map(rowToSummary);
  // Only a full page can have more behind it. A short page means the caller can
  // stop, which is what keeps the client's paging loop terminating.
  const next =
    games.length === parsed.query.limit ? encodeCursor(games[games.length - 1]) : null;
  return json(200, { games, next_cursor: next }, { ...cors, ...READ_CACHE });
}

/** GET /v1/games/{id}: one game, with the move list the replay viewer needs. */
async function handleGame(
  gameId: string,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  let row: Record<string, unknown> | null;
  try {
    row = await env.DB.prepare(GAME_SQL).bind(gameId).first<Record<string, unknown>>();
  } catch (err) {
    console.error("read failed:", err);
    return json(500, { error: "read failed" }, cors);
  }
  if (!row) return json(404, { error: "not found" }, cors);
  return json(200, { game: rowToDetail(row) }, { ...cors, ...READ_CACHE });
}

async function handleWrite(
  req: Request,
  env: Env,
  cors: Record<string, string>,
  ip: string | null,
): Promise<Response> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return json(413, { error: "body too large" }, cors);
  }

  // Read as text rather than req.json(): the client posts with a text/plain
  // content type so that the per-move write stays a CORS simple request and
  // skips the preflight round trip.
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) {
    return json(413, { error: "body too large" }, cors);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json(400, { error: "body is not valid JSON" }, cors);
  }

  const result = validate(parsed);
  if (!result.ok) {
    console.warn("rejected record:", result.error);
    return json(400, { error: result.error }, cors);
  }

  const meta = {
    ip,
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 400) || null,
    country: ((req as { cf?: { country?: string } }).cf?.country) ?? null,
  };

  try {
    await env.DB.prepare(UPSERT_SQL)
      .bind(...bindValues(result.record, new Date().toISOString(), meta))
      .run();
  } catch (err) {
    // Losing a stats write must never look like a problem to the player, but
    // it should be visible in `wrangler tail`.
    console.error("upsert failed:", err);
    return json(500, { error: "write failed" }, cors);
  }
  return json(202, { ok: true }, cors);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("origin");
    const cors = corsHeaders(origin, env);
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: Object.keys(cors).length ? 204 : 403, headers: cors });
    }
    if (req.method === "GET" && url.pathname === "/v1/health") {
      return json(200, { ok: true, version: VERSION }, cors);
    }
    // A browser request must come from a known origin. sendBeacon still sends
    // Origin during unload, so this does not cost us the abandoned-game record.
    if (origin !== null && Object.keys(cors).length === 0) {
      return json(403, { error: "origin not allowed" }, {});
    }

    const gameMatch = GAME_PATH.exec(url.pathname);
    const isRead =
      req.method === "GET" && (url.pathname === "/v1/games" || gameMatch !== null);
    const isWrite = req.method === "POST" && url.pathname === "/v1/games";
    if (!isRead && !isWrite) {
      return json(404, { error: "not found" }, cors);
    }

    // Same budget for reads and writes: a page load spends a handful of GETs,
    // which is nowhere near the per-minute limit, and a scraper paging the
    // whole table is exactly what the limiter is for.
    const ip = req.headers.get("cf-connecting-ip");
    const limited = await env.RATE_LIMIT?.limit({ key: ip ?? "unknown" });
    if (limited && !limited.success) {
      return json(429, { error: "slow down" }, cors);
    }

    if (isWrite) return handleWrite(req, env, cors, ip);
    if (gameMatch) return handleGame(gameMatch[1], env, cors);
    return handleList(url, env, cors);
  },
};
