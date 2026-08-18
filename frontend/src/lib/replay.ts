/**
 * Replays a recorded game by feeding its stored action indices back through the
 * same wasm engine that played it, collecting one StateView per ply so the
 * viewer can scrub with no further computation.
 *
 * The engine is injected rather than imported so this is testable without wasm,
 * and because the viewer owns the Game handle's lifetime (it has to be freed).
 */
import type { StateView } from "./types";

/** The slice of `quoridor-wasm`'s Game this module uses. */
export interface ReplayEngine {
  stateView(): unknown;
  applyAction(index: number): unknown;
}

export interface Replay {
  /** views[i] is the position after i plies; views[0] is the opening position. */
  views: StateView[];
  /**
   * Which ply the engine refused, if any. A recorded game replays cleanly by
   * construction, so this only fires if the rules changed under a stored game --
   * in which case showing the prefix beats showing an error page.
   */
  stoppedAt: number | null;
  error: string | null;
}

export function buildReplay(engine: ReplayEngine, moves: readonly number[]): Replay {
  const views: StateView[] = [engine.stateView() as StateView];
  for (let i = 0; i < moves.length; i++) {
    try {
      views.push(engine.applyAction(moves[i]) as StateView);
    } catch (err) {
      return { views, stoppedAt: i, error: String(err) };
    }
  }
  return { views, stoppedAt: null, error: null };
}

/**
 * Describe the ply that produced `view`, using the engine's own enriched
 * `last_action` so no action-index decoding is duplicated here. `mover` is
 * whoever was on turn in the position before it.
 */
export function describePly(previous: StateView, view: StateView): { mover: number; text: string } {
  const mover = previous.current_player;
  const a = view.last_action;
  if (a === null) return { mover, text: "—" };
  const text =
    a.kind === "move"
      ? `move to (${a.to[0]}, ${a.to[1]})`
      : `wall ${a.orientation} at (${a.row}, ${a.col})`;
  return { mover, text };
}
