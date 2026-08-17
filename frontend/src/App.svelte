<script lang="ts">
  import Board from "./lib/Board.svelte";
  import ControlRail from "./lib/ControlRail.svelte";
  import RulesDialog from "./lib/RulesDialog.svelte";
  import SetupScreen from "./lib/SetupScreen.svelte";
  import WebGpuBanner from "./lib/WebGpuBanner.svelte";
  import { AiClient } from "./lib/aiClient";
  import { checkWebGpu, type WebGpuStatus } from "./lib/webgpu";
  import { MODELS, modelUrl, ortBase, pickDefault, type ModelEntry } from "./lib/models";
  import { loadNick, saveNick } from "./lib/stats";
  import { createAppReporter } from "./lib/statsClient";
  import type { StateView } from "./lib/types";

  const initial = pickDefault(MODELS);

  // The setup screen owns everything above; once a game is running none of it
  // can change, so the AI the game started against is the AI it ends against.
  let started = $state(false);
  let selected = $state<ModelEntry>(initial);
  let view = $state<StateView | null>(null);
  let thinking = $state(false);
  let progress = $state<{ done: number; total: number } | null>(null);
  let error = $state<string | null>(null);
  let humanPlayer = $state(0);
  let nick = $state(loadNick());
  // One dialog for both screens: the rules do not change once a game starts,
  // and a mid-game reader wants the same text a first-time visitor does.
  let showRules = $state(false);
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

  // Anonymous game records, for win rates and replays. Never affects play:
  // every write is fire-and-forget, and it does nothing at all unless the
  // build was given a stats endpoint. See lib/stats.ts and stats-worker/.
  const stats = createAppReporter({ webgpuOk: () => gpu?.ok ?? null, nick: () => nick });

  const ai = new AiClient();
  ai.onState = (v, t) => {
    view = v; thinking = t; if (!t) progress = null;
    stats.recordView(v);
  };
  ai.onProgress = (done, total) => { thinking = true; progress = { done, total }; };
  ai.onError = (m) => { error = m; thinking = false; };

  // The check gates nothing: the worker asks for ["webgpu", "wasm"], so
  // onnxruntime falls back on its own. This only decides whether to warn.
  let gpu = $state<WebGpuStatus | null>(null);
  checkWebGpu().then(
    (status) => { gpu = status; },
    // Defensive: checkWebGpu resolves on every path today. A rejection here
    // would mean a bug in the check itself, which is not worth warning about.
    () => { gpu = { ok: true }; },
  );

  function startGame() {
    saveNick(nick);
    started = true;
    error = null; thinking = true; progress = null; view = null;
    stats.startGame({
      modelLabel: selected.label, modelId: selected.id,
      boardSize: selected.board_size, maxWalls: selected.max_walls,
      maxSteps: selected.max_steps, humanPlayer,
      mctsN: params.mctsN, cPuct: params.cPuct,
      leafParallelism: params.leafParallelism, virtualLoss: params.virtualLoss,
    });
    ai.newGame({
      modelUrl: modelUrl(selected), ortBase: ortBase(),
      boardSize: selected.board_size, maxWalls: selected.max_walls,
      maxSteps: selected.max_steps, humanPlayer, params,
    });
  }

  // Back to the setup screen, keeping the choices that got us here. Walking
  // away mid-game is worth recording: people tend to do it exactly when the
  // result stops being in doubt.
  function backToSetup() {
    stats.abandonGame();
    started = false;
    view = null; thinking = false; progress = null; error = null;
  }

  // Each model carries its own board size and tuned search defaults, so
  // picking one replaces the parameters rather than keeping the old ones.
  function selectModel(entry: ModelEntry) {
    if (entry.id === selected.id) return;
    selected = entry;
    params = {
      mctsN: entry.defaults.mcts_n,
      cPuct: entry.defaults.mcts_c_puct,
      leafParallelism: entry.defaults.leaf_parallelism,
      virtualLoss: entry.defaults.virtual_loss,
    };
  }

  function act(index: number) { thinking = true; ai.move(index); }
</script>

{#if gpu && !gpu.ok}
  <WebGpuBanner status={gpu} />
{/if}

{#if !started}
  <SetupScreen models={MODELS} {selected} {params} {humanPlayer} {nick}
    onmodel={selectModel}
    onparams={(p) => { params = p; }}
    onhumanplayer={(p) => { humanPlayer = p; }}
    onnick={(n) => { nick = n; }}
    onstart={startGame}
    onrules={() => { showRules = true; }} />
{:else}
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
    <ControlRail {view} {thinking} {progress} {selected} {params} {humanPlayer}
      onundo={() => ai.undo(2)} onnewgame={backToSetup}
      onrules={() => { showRules = true; }} />
  </div>
{/if}

<RulesDialog open={showRules}
  boardSize={selected.board_size} maxWalls={selected.max_walls} maxSteps={selected.max_steps}
  onclose={() => { showRules = false; }} />

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
