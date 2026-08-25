import { describe, expect, it } from "vitest";
import { PAGE_SIZE, fetchAllGames, fetchGame, fetchRecentWins, gameUrl, listUrl } from "./statsApi";
import type { GameSummary } from "./statsApi";

const ENDPOINT = "https://stats.example/v1/games";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Serves `total` synthetic games, paging exactly as the worker does -- including
 * the part that matters here: the worker cannot see past the page it just read,
 * so it returns a cursor whenever a page comes back full, even if that page was
 * the last one.
 */
function fakeApi(total: number) {
  const urls: string[] = [];
  const all = Array.from({ length: total }, (_, i) => ({
    game_id: `g-${i}`,
    started_at: `2026-08-13T10:00:${String(i % 60).padStart(2, "0")}.000Z`,
  })) as GameSummary[];

  return {
    urls,
    fetchImpl: async (url: string) => {
      urls.push(url);
      const parsed = new URL(url);
      const limit = Number(parsed.searchParams.get("limit"));
      const cursor = parsed.searchParams.get("cursor");
      const from = cursor === null ? 0 : all.findIndex((g) => g.game_id === cursor.split("|")[1]) + 1;
      const games = all.slice(from, from + limit);
      const next =
        games.length === limit
          ? `${games[games.length - 1].started_at}|${games[games.length - 1].game_id}`
          : null;
      return jsonResponse({ games, next_cursor: next });
    },
  };
}

describe("URLs", () => {
  it("builds the list URL from the collection endpoint", () => {
    expect(listUrl(ENDPOINT, 50, null)).toBe(`${ENDPOINT}?limit=50`);
    expect(listUrl(ENDPOINT, 50, "2026-08-13T10:00:00.000Z|g-1")).toBe(
      `${ENDPOINT}?limit=50&cursor=2026-08-13T10%3A00%3A00.000Z%7Cg-1`,
    );
  });

  it("builds the single-game URL under the same endpoint", () => {
    expect(gameUrl(ENDPOINT, "abc-123")).toBe(`${ENDPOINT}/abc-123`);
    expect(gameUrl(`${ENDPOINT}/`, "abc-123")).toBe(`${ENDPOINT}/abc-123`);
    expect(gameUrl(ENDPOINT, "a/b")).toBe(`${ENDPOINT}/a%2Fb`);
  });
});

describe("fetchAllGames", () => {
  it("follows the cursor to the end", async () => {
    const api = fakeApi(3);
    const { games, truncated } = await fetchAllGames(ENDPOINT, api.fetchImpl, 10);
    expect(games.map((g) => g.game_id)).toEqual(["g-0", "g-1", "g-2"]);
    expect(truncated).toBe(false);
  });

  it("stops at the row cap and says so", async () => {
    const api = fakeApi(10);
    const { games, truncated } = await fetchAllGames(ENDPOINT, api.fetchImpl, 4);
    expect(games).toHaveLength(4);
    expect(truncated).toBe(true);
    // Never asks for more rows than are left in the budget -- except the probe
    // for row 5, which is one row and is not kept.
    for (const url of api.urls.slice(0, -1)) {
      expect(Number(new URL(url).searchParams.get("limit"))).toBeLessThanOrEqual(4);
    }
  });

  // The worker hands back a cursor for any full page, so a database holding
  // exactly the cap's worth of games used to be reported as cut off.
  it("is not truncated when the database holds exactly the cap", async () => {
    const api = fakeApi(4);
    const { games, truncated } = await fetchAllGames(ENDPOINT, api.fetchImpl, 4);
    expect(games).toHaveLength(4);
    expect(truncated).toBe(false);
  });

  it("asks for one row, once, to tell those two cases apart", async () => {
    const api = fakeApi(4);
    await fetchAllGames(ENDPOINT, api.fetchImpl, 4);
    const probes = api.urls.filter((u) => new URL(u).searchParams.get("limit") === "1");
    expect(probes).toHaveLength(1);
  });

  it("does not probe at all when the cap is never reached", async () => {
    const api = fakeApi(3);
    const { truncated } = await fetchAllGames(ENDPOINT, api.fetchImpl, 4);
    expect(truncated).toBe(false);
    expect(api.urls.filter((u) => new URL(u).searchParams.get("limit") === "1")).toHaveLength(0);
  });

  it("asks for whole pages when the budget allows", async () => {
    const api = fakeApi(1);
    await fetchAllGames(ENDPOINT, api.fetchImpl);
    expect(new URL(api.urls[0]).searchParams.get("limit")).toBe(String(PAGE_SIZE));
  });

  it("reports the worker's error message", async () => {
    const fetchImpl = async () => jsonResponse({ error: "limit must be an integer" }, 400);
    await expect(fetchAllGames(ENDPOINT, fetchImpl)).rejects.toThrow(
      /HTTP 400: limit must be an integer/,
    );
  });

  it("rejects a response that is not a page", async () => {
    const fetchImpl = async () => jsonResponse({ nope: true });
    await expect(fetchAllGames(ENDPOINT, fetchImpl)).rejects.toThrow(/unexpected response/);
  });

  // A cursor that keeps pointing at an empty page would otherwise spin forever.
  it("stops on an empty page even with a cursor", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return jsonResponse({ games: [], next_cursor: "2026-08-13T10:00:00.000Z|g-1" });
    };
    const { games } = await fetchAllGames(ENDPOINT, fetchImpl);
    expect(games).toEqual([]);
    expect(calls).toBe(1);
  });
});

describe("fetchGame", () => {
  it("unwraps the game", async () => {
    const fetchImpl = async () => jsonResponse({ game: { game_id: "g-1", moves: [12, 40] } });
    expect((await fetchGame(ENDPOINT, "g-1", fetchImpl)).moves).toEqual([12, 40]);
  });

  it("fails loudly on a missing game", async () => {
    const fetchImpl = async () => jsonResponse({ error: "not found" }, 404);
    await expect(fetchGame(ENDPOINT, "g-1", fetchImpl)).rejects.toThrow(/HTTP 404: not found/);
  });
});

describe("fetchRecentWins", () => {
  const row = (over: Partial<GameSummary> = {}): GameSummary =>
    ({ game_id: "g-1", outcome: "human_win", model_id: "b9w10-v0", ...over }) as GameSummary;

  it("asks the worker for one model's wins", async () => {
    const urls: string[] = [];
    await fetchRecentWins(ENDPOINT, "b9w10-v0", 5, async (url) => {
      urls.push(url);
      return jsonResponse({ games: [], next_cursor: null });
    });
    const parsed = new URL(urls[0]);
    expect(parsed.searchParams.get("limit")).toBe("5");
    expect(parsed.searchParams.get("outcome")).toBe("human_win");
    expect(parsed.searchParams.get("model_id")).toBe("b9w10-v0");
  });

  // A worker whose deploy is still waiting for an approval click does not know
  // these parameters, and answers by ignoring them -- which would put other
  // people's losses against other models on the wall as human victories. Any
  // row revalidation drops is proof of that (outcome/model_id are compared
  // with ordinary equality on both sides), so a mixed response must reject
  // rather than quietly resolve to the rows that do match.
  it("rejects a response mixing matching and non-matching rows", async () => {
    const games = [
      row({ game_id: "keep" }),
      row({ game_id: "wrong-outcome", outcome: "ai_win" }),
      row({ game_id: "wrong-model", model_id: "b5w5-v0" }),
    ];
    await expect(
      fetchRecentWins(ENDPOINT, "b9w10-v0", 5, async () => jsonResponse({ games, next_cursor: null })),
    ).rejects.toThrow();
  });

  // What an old worker actually returns: a game is written as in_progress,
  // with outcome null, before a single move is played, so the newest rows of
  // any kind are overwhelmingly outcome: null. This must not resolve to [],
  // which the component would render as "nobody has ever beaten this model."
  it("rejects a response of games an old worker never filtered at all", async () => {
    const games = Array.from({ length: 5 }, (_, i) => row({ game_id: `g-${i}`, outcome: null }));
    await expect(
      fetchRecentWins(ENDPOINT, "b9w10-v0", 5, async () => jsonResponse({ games, next_cursor: null })),
    ).rejects.toThrow();
  });

  // The one case where revalidation cannot disagree with the worker: a
  // genuine zero wins must still read as zero wins, not as an error.
  it("resolves to an empty array on a genuine zero-wins response", async () => {
    const wins = await fetchRecentWins(ENDPOINT, "b9w10-v0", 5, async () =>
      jsonResponse({ games: [], next_cursor: null }),
    );
    expect(wins).toEqual([]);
  });

  it("resolves with every row when the worker filtered correctly", async () => {
    const games = [row({ game_id: "a" }), row({ game_id: "b" }), row({ game_id: "c" })];
    const wins = await fetchRecentWins(ENDPOINT, "b9w10-v0", 5, async () =>
      jsonResponse({ games, next_cursor: null }),
    );
    expect(wins.map((g) => g.game_id)).toEqual(["a", "b", "c"]);
  });

  it("never returns more than asked for", async () => {
    const games = Array.from({ length: 9 }, (_, i) => row({ game_id: `g-${i}` }));
    const wins = await fetchRecentWins(ENDPOINT, "b9w10-v0", 5, async () =>
      jsonResponse({ games, next_cursor: null }),
    );
    expect(wins).toHaveLength(5);
  });

  it("rejects rather than pretending there are no wins", async () => {
    await expect(
      fetchRecentWins(ENDPOINT, "b9w10-v0", 5, async () => jsonResponse({ error: "boom" }, 500)),
    ).rejects.toThrow();
  });
});
