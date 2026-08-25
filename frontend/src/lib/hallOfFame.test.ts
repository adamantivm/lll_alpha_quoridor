import { describe, expect, it } from "vitest";
import { levelPhrase, winSentence } from "./hallOfFame";
import type { GameSummary } from "./statsApi";

/** A recorded human win. Only the fields the prose reads are meaningful. */
function win(over: Partial<GameSummary> = {}): GameSummary {
  return {
    nick: "Julian",
    human_player: 1,
    preset: "normal",
    move_count: 43,
    started_at: "2026-08-12T18:30:00.000Z",
    ...over,
  } as GameSummary;
}

describe("levelPhrase", () => {
  it("names a known level", () => {
    expect(levelPhrase("normal")).toBe("on Normal");
    expect(levelPhrase("difficult")).toBe("on Difficult");
  });

  // Hand-edited parameters, and games recorded before levels existed. Neither
  // is a level, and dropping those games would silently shrink the wall.
  it("says what it can about the levels that are not levels", () => {
    expect(levelPhrase("custom")).toBe("on custom settings");
    expect(levelPhrase("unknown")).toBe("on an unknown level");
    expect(levelPhrase("something-else")).toBe("on an unknown level");
  });
});

describe("winSentence", () => {
  it("reads as a sentence", () => {
    expect(winSentence(win())).toMatch(/^Julian won as P2 on Normal in 43 moves, .+\.$/);
  });

  // human_player is 0-indexed: 0 is the player who moves first.
  it("calls the first player P1", () => {
    expect(winSentence(win({ human_player: 0 }))).toContain("won as P1");
  });

  it("does not say 1 moves", () => {
    expect(winSentence(win({ move_count: 1 }))).toContain("in 1 move,");
  });
});
