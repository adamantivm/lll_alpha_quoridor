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
 */
export function levelPhrase(preset: string): string {
  if (preset === "custom") return "on custom settings";
  const label = PRESET_LABEL[preset as Preset];
  return label ? `on ${label}` : "on an unknown level";
}

/** One recorded victory, as a sentence. */
export function winSentence(g: GameSummary): string {
  // human_player is 0-indexed, and 0 is the player who moves first.
  const side = g.human_player === 0 ? "P1" : "P2";
  const moves = g.move_count === 1 ? "1 move" : `${g.move_count} moves`;
  const when = new Date(g.started_at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${g.nick} won as ${side} ${levelPhrase(g.preset)} in ${moves}, ${when}.`;
}
