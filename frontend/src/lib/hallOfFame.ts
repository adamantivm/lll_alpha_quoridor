/**
 * The sentences the play page's hall of fame is made of.
 *
 * Pure, and separate from the component, so the wording is tested without a
 * DOM -- this repo has no component test harness, and prose is the part worth
 * testing anyway.
 */
import { PRESET_LABEL, type Preset } from "./difficulty";
import type { GameSummary } from "./statsApi";

/**
 * How a game's difficulty reads mid-sentence.
 *
 * `custom` means the parameters were hand-edited under Advanced; `unknown`
 * means the game predates levels. Neither is a level, and neither is a reason
 * to leave a real victory off the wall.
 *
 * `Object.hasOwn` guards against `preset` being an arbitrary string rather
 * than a real `Preset`: a plain index (`PRESET_LABEL[preset as Preset]`)
 * would resolve to inherited `Object.prototype` members for names like
 * `"constructor"` instead of falling through to the unknown-level phrase.
 * The worker allowlists `preset` at write time, so today no recorded game can
 * trigger this, but the function is exported and takes a bare `string`.
 */
export function levelPhrase(preset: string): string {
  if (preset === "custom") return "on custom settings";
  if (Object.hasOwn(PRESET_LABEL, preset)) return `on ${PRESET_LABEL[preset as Preset]}`;
  return "on an unknown level";
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
// The point at which "N weeks ago" stops reading naturally and "N months
// ago" takes over. Not a calendar month boundary -- just "about 5 weeks".
const FIVE_WEEKS = 5 * WEEK;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

/**
 * How long ago a timestamp was, as an always-English, locale-independent
 * phrase -- "5 days ago", never a formatted date. A wall of recent victories
 * is more useful read as "how long ago" than as a date the visitor has to do
 * arithmetic on, and unlike `toLocaleDateString` it renders identically for
 * every visitor instead of following the browser's locale.
 *
 * `now` is a parameter rather than read from the clock internally so the
 * seven branches below (and their boundaries) are testable without freezing
 * time.
 *
 * A `started_at` in the future -- clock skew between the server that stamped
 * it and the visitor's machine -- is clamped to zero elapsed time and reads
 * as "just now" rather than a negative or NaN duration.
 */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const elapsedMs = now - new Date(iso).getTime();
  const elapsedS = Math.max(0, Math.floor(elapsedMs / 1000));

  if (elapsedS < MINUTE) return "just now";
  if (elapsedS < HOUR) return plural(Math.floor(elapsedS / MINUTE), "minute");
  if (elapsedS < DAY) return plural(Math.floor(elapsedS / HOUR), "hour");
  if (elapsedS < WEEK) return plural(Math.floor(elapsedS / DAY), "day");
  if (elapsedS < FIVE_WEEKS) return plural(Math.floor(elapsedS / WEEK), "week");
  if (elapsedS < YEAR) return plural(Math.floor(elapsedS / MONTH), "month");
  return plural(Math.floor(elapsedS / YEAR), "year");
}

/**
 * One recorded victory, as a sentence.
 *
 * `now` passes straight through to `timeAgo` so this stays testable without
 * the wall clock; in production callers leave it unset and get `Date.now()`.
 */
export function winSentence(g: GameSummary, now?: number): string {
  // human_player is 0-indexed, and 0 is the player who moves first.
  const side = g.human_player === 0 ? "P1" : "P2";
  const moves = g.move_count === 1 ? "1 move" : `${g.move_count} moves`;
  return `${g.nick} won as ${side} ${levelPhrase(g.preset)} in ${moves}, ${timeAgo(g.started_at, now)}.`;
}
