<script lang="ts">
  import Board from "./lib/Board.svelte";
  import ControlRail from "./lib/ControlRail.svelte";
  import ConfigDrawer from "./lib/ConfigDrawer.svelte";
  import { AiClient } from "./lib/aiClient";
  import { MODELS, modelUrl, ortBase, pickDefault, type ModelEntry } from "./lib/models";
  import type { StateView } from "./lib/types";

  const initial = pickDefault(MODELS);

  let selected = $state<ModelEntry>(initial);
  let view = $state<StateView | null>(null);
  let thinking = $state(false);
  let progress = $state<{ done: number; total: number } | null>(null);
  let error = $state<string | null>(null);
  let humanPlayer = $state(0);
  let params = $state({
    mctsN: initial.defaults.mcts_n,
    cPuct: initial.defaults.mcts_c_puct,
    leafParallelism: initial.defaults.leaf_parallelism,
    virtualLoss: initial.defaults.virtual_loss,
  });

  // True only when the human may act: their turn, game live, AI not working.
  const awaitingHuman = $derived(
    !!view && view.winner == null && view.current_player === view.human_player && !thinking,
  );

  const ai = new AiClient();
  ai.onState = (v, t) => { view = v; thinking = t; if (!t) progress = null; };
  ai.onProgress = (done, total) => { thinking = true; progress = { done, total }; };
  ai.onError = (m) => { error = m; thinking = false; };

  // Models are known at build time, so there is no loading state to wait for.
  newGame();

  function newGame() {
    error = null; thinking = true; progress = null;
    ai.newGame({
      modelUrl: modelUrl(selected), ortBase: ortBase(),
      boardSize: selected.board_size, maxWalls: selected.max_walls,
      maxSteps: selected.max_steps, humanPlayer, params,
    });
  }

  // Switching models can change the board, so it has to restart the game
  // rather than swap the network under a position that may not be legal.
  function selectModel(entry: ModelEntry) {
    if (entry.id === selected.id) return;
    selected = entry;
    params = {
      mctsN: entry.defaults.mcts_n,
      cPuct: entry.defaults.mcts_c_puct,
      leafParallelism: entry.defaults.leaf_parallelism,
      virtualLoss: entry.defaults.virtual_loss,
    };
    newGame();
  }

  function act(index: number) { thinking = true; ai.move(index); }
</script>

<div class="layout">
  <div>
    {#if error}<p class="err">Error: {error}</p>{/if}
    {#if view}
      <div class="status" class:thinking>
        {#if view.winner != null}
          {view.winner === view.human_player ? "You won! 🎉" : "AI won"}
        {:else if thinking}
          <span class="dot"></span> AI is thinking…{#if progress} {progress.done}/{progress.total} sims{/if}
        {:else}
          Your move — you are blue, at the bottom, moving up
        {/if}
      </div>
      <Board {view} disabled={!awaitingHuman} onaction={act} />
    {:else}
      <p>Loading…</p>
    {/if}
  </div>
  <ControlRail {view} {thinking} {progress} onundo={() => ai.undo(2)} onnewgame={newGame} />
  <ConfigDrawer models={MODELS} {selected} {params} {humanPlayer}
    onmodel={selectModel}
    onparams={(p) => { params = p; ai.setParams(p); }}
    onhumanplayer={(p) => { humanPlayer = p; }} />
</div>

<style>
  .layout { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
  .err { color: #c0392b; }
  .status {
    font-weight: 600;
    margin-bottom: 8px;
    min-height: 1.4em;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .status.thinking { color: #b45309; }
  .dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: #b45309;
    animation: pulse 0.9s ease-in-out infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
</style>
