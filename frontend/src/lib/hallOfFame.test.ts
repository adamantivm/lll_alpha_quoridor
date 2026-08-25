import { describe, expect, it } from "vitest";
import { levelPhrase, timeAgo, winSentence } from "./hallOfFame";
import type { GameSummary } from "./statsApi";

const BASE = "2026-08-12T18:30:00.000Z";
const BASE_MS = new Date(BASE).getTime();

/** `now`, expressed as an offset in milliseconds from BASE. */
function at(offsetMs: number): number {
  return BASE_MS + offsetMs;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** A recorded human win. Only the fields the prose reads are meaningful. */
function win(over: Partial<GameSummary> = {}): GameSummary {
  return {
    nick: "Julian",
    human_player: 1,
    preset: "normal",
    move_count: 43,
    started_at: BASE,
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

  // PRESET_LABEL is a plain object; indexing it with an unchecked string
  // would resolve inherited Object.prototype members instead of falling
  // through to the unknown-level phrase.
  it("does not resolve Object.prototype members", () => {
    expect(levelPhrase("constructor")).toBe("on an unknown level");
    expect(levelPhrase("toString")).toBe("on an unknown level");
  });
});

describe("timeAgo", () => {
  it("reads under a minute as just now", () => {
    expect(timeAgo(BASE, at(0))).toBe("just now");
    expect(timeAgo(BASE, at(59 * SECOND))).toBe("just now");
  });

  it("reads minutes, singular and plural", () => {
    expect(timeAgo(BASE, at(MINUTE))).toBe("1 minute ago");
    expect(timeAgo(BASE, at(2 * MINUTE))).toBe("2 minutes ago");
  });

  it("switches from minutes to hours across the hour boundary", () => {
    expect(timeAgo(BASE, at(59 * MINUTE))).toBe("59 minutes ago");
    expect(timeAgo(BASE, at(61 * MINUTE))).toBe("1 hour ago");
  });

  it("reads hours, singular and plural", () => {
    expect(timeAgo(BASE, at(HOUR))).toBe("1 hour ago");
    expect(timeAgo(BASE, at(5 * HOUR))).toBe("5 hours ago");
  });

  it("switches from hours to days across the day boundary", () => {
    expect(timeAgo(BASE, at(23 * HOUR))).toBe("23 hours ago");
    expect(timeAgo(BASE, at(25 * HOUR))).toBe("1 day ago");
  });

  it("reads days, singular and plural", () => {
    expect(timeAgo(BASE, at(DAY))).toBe("1 day ago");
    expect(timeAgo(BASE, at(5 * DAY))).toBe("5 days ago");
  });

  it("switches from days to weeks across the week boundary", () => {
    expect(timeAgo(BASE, at(6 * DAY))).toBe("6 days ago");
    expect(timeAgo(BASE, at(8 * DAY))).toBe("1 week ago");
  });

  it("reads weeks, singular and plural", () => {
    expect(timeAgo(BASE, at(WEEK))).toBe("1 week ago");
    expect(timeAgo(BASE, at(2 * WEEK))).toBe("2 weeks ago");
  });

  it("switches from weeks to months across the five-week boundary", () => {
    expect(timeAgo(BASE, at(34 * DAY))).toBe("4 weeks ago");
    expect(timeAgo(BASE, at(36 * DAY))).toBe("1 month ago");
  });

  it("reads months, singular and plural", () => {
    expect(timeAgo(BASE, at(40 * DAY))).toBe("1 month ago");
    expect(timeAgo(BASE, at(100 * DAY))).toBe("3 months ago");
  });

  it("switches from months to years across the year boundary", () => {
    expect(timeAgo(BASE, at(364 * DAY))).toBe("12 months ago");
    expect(timeAgo(BASE, at(366 * DAY))).toBe("1 year ago");
  });

  it("reads years, singular and plural", () => {
    expect(timeAgo(BASE, at(400 * DAY))).toBe("1 year ago");
    expect(timeAgo(BASE, at(800 * DAY))).toBe("2 years ago");
  });

  // Clock skew between the server that stamped started_at and the visitor's
  // machine can put a timestamp in the future. That must not read as a
  // negative or NaN duration.
  it("treats a future timestamp as just now", () => {
    expect(timeAgo(BASE, at(-3 * DAY))).toBe("just now");
  });
});

describe("winSentence", () => {
  it("reads as a sentence", () => {
    expect(winSentence(win(), at(5 * DAY))).toBe(
      "Julian won as P2 on Normal in 43 moves, 5 days ago.",
    );
  });

  // human_player is 0-indexed: 0 is the player who moves first.
  it("calls the first player P1", () => {
    expect(winSentence(win({ human_player: 0 }), at(5 * DAY))).toContain("won as P1");
  });

  it("does not say 1 moves", () => {
    expect(winSentence(win({ move_count: 1 }), at(5 * DAY))).toContain("in 1 move,");
  });
});
