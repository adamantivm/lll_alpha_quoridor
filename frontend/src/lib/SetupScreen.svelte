<script lang="ts">
  import type { ModelEntry } from "./models";
  import {
    MAX_SIMS, MIN_SIMS, PRESETS, PRESET_BLURB, PRESET_LABEL, SIMS_STEP,
    type Difficulty, type Preset, type SearchParams,
  } from "./difficulty";
  import { MAX_NICK_LENGTH } from "./stats";
  let { models, selected, params, difficulty, humanPlayer, nick,
        onmodel, onparams, onpreset, onhumanplayer, onnick, onstart, onrules }: {
    models: ModelEntry[];
    selected: ModelEntry;
    params: SearchParams;
    difficulty: Difficulty;
    humanPlayer: number;
    nick: string;
    onmodel: (entry: ModelEntry) => void;
    onparams: (params: SearchParams) => void;
    onpreset: (p: Preset) => void;
    onhumanplayer: (p: number) => void;
    onnick: (nick: string) => void;
    onstart: () => void;
    onrules: () => void;
  } = $props();

  // Whitespace is not a name. This is the same trim the reporter and the stats
  // worker apply, so what gates the button is what would be recorded.
  const named = $derived(nick.trim().length > 0);
</script>

<div class="setup">
  <h1>Quoridor</h1>
  <p class="lede">
    Play against a network trained by self-play. Set the game up, then start.
    New to the game? <button type="button" class="link" onclick={onrules}>How to play</button>.
  </p>

  <label>Nickname
    <input type="text" value={nick} maxlength={MAX_NICK_LENGTH} required
      placeholder="How should we call you?"
      oninput={(e) => onnick(e.currentTarget.value)} />
    <small class="hint">Stored with the game record so you can find your games later.</small>
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

  <!-- Difficulty. Fixed for the whole game: changing the opponent's strength
       half-way through makes the game, and its record, meaningless. -->
  <div class="who">
    <span class="who-label">Difficulty</span>
    <div class="segmented levels">
      {#each PRESETS as p}
        <label class:sel={difficulty === p}>
          <input type="radio" name="difficulty" checked={difficulty === p}
            onchange={() => onpreset(p)} />
          {PRESET_LABEL[p]}
        </label>
      {/each}
    </div>
    <small class="hint">
      {#if difficulty === "custom"}
        Custom — {params.mctsN} sims, c_puct {params.cPuct}.
      {:else}
        {params.mctsN} sims · {PRESET_BLURB[difficulty]}.
      {/if}
    </small>
  </div>

  <!-- The raw parameters, for people who came for them. Opening this changes
       nothing; editing a slider is what makes the setting Custom. -->
  <details class="advanced">
    <summary>Advanced</summary>
    <fieldset>
      <small class="hint">
        The search parameters behind the levels above. Moving any of them
        switches the difficulty to Custom.
      </small>

      <label>MCTS sims: {params.mctsN}
        <input type="range" min={MIN_SIMS} max={MAX_SIMS} step={SIMS_STEP} value={params.mctsN}
          oninput={(e) => onparams({ ...params, mctsN: +e.currentTarget.value })} />
        <small class="hint">
          How many possible continuations the AI tries before committing to a move.
          More is stronger and slower — this is the main strength dial.
        </small>
      </label>

      <label>c_puct: {params.cPuct}
        <input type="range" min="0.5" max="3" step="0.1" value={params.cPuct}
          oninput={(e) => onparams({ ...params, cPuct: +e.currentTarget.value })} />
        <small class="hint">
          How curious the search is. Low values dig deeper into the moves it
          already likes; high values spread the same effort over more candidates.
          The default is tuned — moving it far either way tends to play worse, not
          faster.
        </small>
      </label>

      <label>leaf parallelism: {params.leafParallelism}
        <input type="range" min="1" max="32" step="1" value={params.leafParallelism}
          oninput={(e) => onparams({ ...params, leafParallelism: +e.currentTarget.value })} />
        <small class="hint">
          How many positions are sent to the network at once. More is faster,
          because your GPU would rather grade a batch than one at a time — but the
          search has to guess about the positions still in flight, so the AI may
          play slightly worse.
        </small>
      </label>
    </fieldset>
  </details>

  <button class="start" onclick={onstart} disabled={!named}>Start game</button>
  {#if !named}<small class="hint need-nick">Enter a nickname to start.</small>{/if}
</div>

<style>
  .setup {
    display: flex;
    flex-direction: column;
    gap: 14px;
    /* border-box so the cap includes the padding below -- otherwise the card
       is 460px wide and overflows a phone screen just like the board did. */
    box-sizing: border-box;
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
    gap: 12px;
    margin: 0;
    padding: 10px 12px 12px;
    border: 1px solid #e0d3b8;
    border-radius: 8px;
  }
  fieldset .hint { line-height: 1.4; }
  .who { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; }
  .who-label { font-weight: 600; }
  .segmented { display: flex; flex-wrap: wrap; gap: 6px; }
  /* Four labels do not fit 360px in one line; each keeps its text on one line
     and the row wraps to two. */
  .levels label { flex: 1 1 auto; white-space: nowrap; }
  .advanced summary {
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    color: #6b5a3f;
  }
  .advanced fieldset { margin-top: 8px; }
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
  /* A button, because it opens a dialog rather than going anywhere, but it
     should read as the link it looks like. */
  .link {
    font: inherit;
    padding: 0;
    border: 0;
    background: none;
    color: #1e3a8a;
    text-decoration: underline;
    cursor: pointer;
  }
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
  .start:hover:not(:disabled) { background: #17306f; }
  .start:disabled { background: #b9bdcb; cursor: not-allowed; }
  .need-nick { margin-top: -8px; text-align: center; }
</style>
