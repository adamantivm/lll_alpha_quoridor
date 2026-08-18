import { describe, expect, it } from "vitest";
import { PAGE_SIZE, fetchAllGames, fetchGame, gameUrl, listUrl } from "./statsApi";
import type { GameSummary } from "./statsApi";

const ENDPOINT = "https://stats.example/v1/games";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Serves `total` synthetic games, paging exactly as the worker does. */
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
        games.length === limit && from + limit < all.length
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
    // Never asks for more rows than are left in the budget.
    for (const url of api.urls) {
      expect(Number(new URL(url).searchParams.get("limit"))).toBeLessThanOrEqual(4);
    }
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
