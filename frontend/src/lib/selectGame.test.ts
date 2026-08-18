import { describe, expect, it } from "vitest";
import { createGameSelector, type SelectionSink } from "./selectGame";
import type { GameDetail } from "./statsApi";

function detail(gameId: string): GameDetail {
  return { game_id: gameId, moves: [], action_log: [] } as unknown as GameDetail;
}

/** Records what the page would be showing, and lets each load be resolved by hand. */
function harness() {
  const pending = new Map<string, { resolve: (g: GameDetail) => void; reject: (e: unknown) => void }>();
  const state: { game: GameDetail | null; error: string | null } = { game: null, error: null };
  const sink: SelectionSink = {
    setGame: (g) => { state.game = g; },
    setError: (m) => { state.error = m; },
  };
  const select = createGameSelector(
    (gameId) => new Promise<GameDetail>((resolve, reject) => pending.set(gameId, { resolve, reject })),
    sink,
  );
  return { state, select, pending };
}

/** Let the microtask queue drain, so a settled promise has reached the sink. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("createGameSelector", () => {
  it("shows the game that was selected last, whatever order they answer in", async () => {
    const h = harness();
    void h.select("a");
    void h.select("b");

    h.pending.get("b")!.resolve(detail("b"));
    await settle();
    expect(h.state.game?.game_id).toBe("b");

    // A finally answers, long after it stopped being the selection.
    h.pending.get("a")!.resolve(detail("a"));
    await settle();
    expect(h.state.game?.game_id).toBe("b");
    expect(h.state.error).toBeNull();
  });

  it("ignores an error from a selection that has been superseded", async () => {
    const h = harness();
    void h.select("a");
    void h.select("b");

    h.pending.get("b")!.resolve(detail("b"));
    await settle();
    h.pending.get("a")!.reject(new Error("HTTP 500"));
    await settle();

    expect(h.state.game?.game_id).toBe("b");
    expect(h.state.error).toBeNull();
  });

  it("reports the error of the current selection", async () => {
    const h = harness();
    void h.select("a");
    h.pending.get("a")!.reject(new Error("HTTP 404: not found"));
    await settle();
    expect(h.state.game).toBeNull();
    expect(h.state.error).toMatch(/Could not load that game: HTTP 404: not found/);
  });

  it("clears the previous game and error as soon as a new one is picked", async () => {
    const h = harness();
    void h.select("a");
    h.pending.get("a")!.resolve(detail("a"));
    await settle();
    expect(h.state.game?.game_id).toBe("a");

    void h.select("b");
    expect(h.state.game).toBeNull();
    expect(h.state.error).toBeNull();
  });
});
