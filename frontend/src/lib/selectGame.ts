/**
 * Loading the game behind a click, without letting a slow answer overwrite a
 * fast one.
 *
 * Picking a game fetches its move list. Pick A and then B straight away and the
 * two requests race: if A's answer arrives last it would replace B on screen,
 * and an error from A would replace B with a failure message. A sequence
 * number fixes both -- only the newest selection is allowed to write anything.
 *
 * Deliberately small and specific to the stats page: it is a counter and two
 * setters, not a request manager.
 */
import type { GameDetail } from "./statsApi";

/** Where the newest result lands. Both are called for every selection. */
export interface SelectionSink {
  setGame(game: GameDetail | null): void;
  setError(message: string | null): void;
}

export function describeSelectError(err: unknown): string {
  return `Could not load that game: ${err instanceof Error ? err.message : err}`;
}

/**
 * Returns a `select(id)` that clears the current selection, loads the game and
 * publishes it -- unless another selection has started in the meantime, in
 * which case the result is dropped.
 */
export function createGameSelector(
  load: (gameId: string) => Promise<GameDetail>,
  sink: SelectionSink,
): (gameId: string) => Promise<void> {
  let latest = 0;
  return async function select(gameId: string): Promise<void> {
    const mine = ++latest;
    sink.setGame(null);
    sink.setError(null);
    try {
      const game = await load(gameId);
      if (mine === latest) sink.setGame(game);
    } catch (err) {
      if (mine === latest) sink.setError(describeSelectError(err));
    }
  };
}
