/**
 * Collects game records from the static play site into D1.
 *
 * One endpoint, POST /v1/games, which upserts the whole record. The client
 * writes after every move, so a game abandoned mid-play is still replayable up
 * to the position the player walked away from.
 */
import { MAX_BODY_BYTES, validate } from "./record";
import { UPSERT_SQL, bindValues } from "./sql";

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
    "access-control-allow-methods": "POST, OPTIONS",
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("origin");
    const cors = corsHeaders(origin, env);
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: Object.keys(cors).length ? 204 : 403, headers: cors });
    }
    if (req.method === "GET" && url.pathname === "/v1/health") {
      return json(200, { ok: true }, cors);
    }
    if (req.method !== "POST" || url.pathname !== "/v1/games") {
      return json(404, { error: "not found" }, cors);
    }
    // A browser request must come from a known origin. sendBeacon still sends
    // Origin during unload, so this does not cost us the abandoned-game record.
    if (origin !== null && Object.keys(cors).length === 0) {
      return json(403, { error: "origin not allowed" }, {});
    }

    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) {
      return json(413, { error: "body too large" }, cors);
    }

    const ip = req.headers.get("cf-connecting-ip");
    const limited = await env.RATE_LIMIT?.limit({ key: ip ?? "unknown" });
    if (limited && !limited.success) {
      return json(429, { error: "slow down" }, cors);
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
  },
};
