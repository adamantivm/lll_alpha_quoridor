<script lang="ts">
  import { presetLabel, type Difficulty, type SearchParams } from "./difficulty";
  import type { ModelEntry } from "./models";
  import type { StateView } from "./types";
  let { view, thinking, progress, selected, params, difficulty, humanPlayer, onundo, onnewgame, onrules }: {
    view: StateView | null;
    thinking: boolean;
    progress: { done: number; total: number } | null;
    selected: ModelEntry;
    params: SearchParams;
    difficulty: Difficulty;
    humanPlayer: number;
    onundo: () => void;
    onnewgame: () => void;
    onrules: () => void;
  } = $props();
  const pct = $derived(progress && progress.total ? Math.round((100 * progress.done) / progress.total) : 0);
</script>

<div class="rail">
  {#if thinking}
    <div class="card">
      <strong>AI thinking…</strong>
      <div class="bar"><div class="fill" style="width:{pct}%"></div></div>
      <small>{progress?.done ?? 0} / {progress?.total ?? 0} sims</small>
    </div>
  {/if}
  {#if view?.winner != null}
    <div class="card"><strong>{view.winner === view.human_player ? "You win!" : "AI wins"}</strong></div>
  {/if}
  <!-- Undo my last move: removes the AI's reply + my move (2 plies), back to my turn.
       Only when it's my turn with at least my move + a reply to undo. -->
  <button
    onclick={onundo}
    disabled={thinking || !view || view.move_history.length < 2 || view.current_player !== view.human_player}
  >↶ Undo</button>
  <!-- Back to the setup screen rather than straight into another game: the
       settings are only changeable there, and this is the way back to them. -->
  <button onclick={onnewgame} disabled={thinking}>New game</button>
  {#if view}
    <div class="card">
      <strong>Walls</strong> — You {view.human_player === 0 ? view.p1_walls : view.p2_walls}
      · AI {view.human_player === 0 ? view.p2_walls : view.p1_walls}
    </div>
    <div class="card"><strong>Moves</strong>: {view.move_history.length}</div>
  {/if}
  <!-- Fixed for the game, so this is a readout, not a control. -->
  <div class="card setup">
    <strong>This game</strong>
    <div>{selected.label}</div>
    <div>You play {humanPlayer === 0 ? "first" : "second"}</div>
    <div>{presetLabel(difficulty)} · {params.mctsN} sims · c_puct {params.cPuct} · leaf {params.leafParallelism}</div>
  </div>
  <!-- Reachable mid-game on purpose: the jump and wall rules are exactly the
       ones a new player looks up while staring at a position. -->
  <button onclick={onrules}>How to play</button>
</div>

<style>
  .rail { display: flex; flex-direction: column; gap: 10px; width: 240px; max-width: 100%; }
  .card { border: 1px solid #ccc; border-radius: 6px; padding: 8px; }
  .bar { height: 12px; background: #ddd; border-radius: 6px; overflow: hidden; margin: 6px 0; }
  .fill { height: 100%; background: #2a7; }
  .setup { color: #6b5a3f; font-size: 0.85rem; }
  .setup strong { color: initial; }
</style>
