<script lang="ts">
  import type { ModelEntry } from "./models";
  import { MAX_NICK_LENGTH } from "./stats";
  type Params = { mctsN: number; cPuct: number; leafParallelism: number; virtualLoss: number };
  let { models, selected, params, humanPlayer, nick, onmodel, onparams, onhumanplayer, onnick, onstart }: {
    models: ModelEntry[];
    selected: ModelEntry;
    params: Params;
    humanPlayer: number;
    nick: string;
    onmodel: (entry: ModelEntry) => void;
    onparams: (params: Params) => void;
    onhumanplayer: (p: number) => void;
    onnick: (nick: string) => void;
    onstart: () => void;
  } = $props();
</script>

<div class="setup">
  <h1>Quoridor</h1>
  <p class="lede">Play against a network trained by self-play. Set the game up, then start.</p>

  <label>Nickname
    <input type="text" value={nick} maxlength={MAX_NICK_LENGTH} placeholder="anonymous"
      oninput={(e) => onnick(e.currentTarget.value)} />
    <small class="hint">Optional. Stored with the game record so you can find your games later.</small>
  </label>

  <label>Model
    <select value={selected.id}
      onchange={(e) => {
        const m = models.find((x) => x.id === e.currentTarget.value);
        if (m) onmodel(m);
      }}>
      {#each models as m}<option value={m.id}>{m.label}</option>{/each}
    </select>
    <small class="hint">{selected.board_size}×{selected.board_size} board, {selected.max_walls} walls each.</small>
  </label>

  <div class="who">
    <span class="who-label">You play</span>
    <div class="segmented">
      <label class:sel={humanPlayer === 0}>
        <input type="radio" name="human-player" checked={humanPlayer === 0} onchange={() => onhumanplayer(0)} />
        First (P1)
      </label>
      <label class:sel={humanPlayer === 1}>
        <input type="radio" name="human-player" checked={humanPlayer === 1} onchange={() => onhumanplayer(1)} />
        Second (P2)
      </label>
    </div>
    <small class="hint">{humanPlayer === 0 ? "You move first." : "The AI moves first."}</small>
  </div>

  <!-- Search settings. Fixed for the whole game: changing the opponent's
       strength half-way through makes the game, and its record, meaningless. -->
  <fieldset>
    <legend>AI search</legend>
    <label>MCTS sims: {params.mctsN}
      <input type="range" min="16" max="2000" step="16" value={params.mctsN}
        oninput={(e) => onparams({ ...params, mctsN: +e.currentTarget.value })} />
    </label>
    <label>c_puct: {params.cPuct}
      <input type="range" min="0.5" max="3" step="0.1" value={params.cPuct}
        oninput={(e) => onparams({ ...params, cPuct: +e.currentTarget.value })} />
    </label>
    <label>leaf parallelism: {params.leafParallelism}
      <input type="range" min="1" max="32" step="1" value={params.leafParallelism}
        oninput={(e) => onparams({ ...params, leafParallelism: +e.currentTarget.value })} />
    </label>
    <small class="hint">More sims means a stronger, slower opponent. Defaults come with the model.</small>
  </fieldset>

  <button class="start" onclick={onstart}>Start game</button>
</div>

<style>
  .setup {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 420px;
    margin: 0 auto;
    padding: 20px;
    border: 1px solid #c9b48a;
    border-radius: 10px;
    background: #fffaf1;
  }
  h1 { margin: 0; font-size: 1.6rem; }
  .lede { margin: 0; color: #6b5a3f; font-size: 0.9rem; }
  label { display: flex; flex-direction: column; font-size: 0.85rem; gap: 2px; }
  input[type="text"], select { font: inherit; padding: 4px 6px; }
  fieldset {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 10px 12px 12px;
    border: 1px solid #e0d3b8;
    border-radius: 8px;
  }
  legend { font-size: 0.85rem; font-weight: 600; padding: 0 4px; }
  .who { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; }
  .who-label { font-weight: 600; }
  .segmented { display: flex; gap: 6px; }
  .segmented label {
    flex: 1;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 4px 6px;
    border: 1px solid #c9b48a;
    border-radius: 6px;
    cursor: pointer;
    background: #fff;
  }
  .segmented label.sel { background: #1e3a8a; color: #fff; border-color: #1e3a8a; }
  .segmented input { margin: 0; }
  .hint { color: #6b5a3f; }
  .start {
    font: inherit;
    font-weight: 600;
    padding: 10px;
    border: 0;
    border-radius: 8px;
    background: #1e3a8a;
    color: #fff;
    cursor: pointer;
  }
  .start:hover { background: #17306f; }
</style>
