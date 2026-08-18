<script lang="ts">
  import initWasm, { Game, init as installPanicHook } from "quoridor-wasm";
  import Board from "./Board.svelte";
  import { buildReplay, buildWarning, describePly, type Replay } from "./replay";
  import type { GameDetail } from "./statsApi";

  let { game }: { game: GameDetail } = $props();

  // Shared across every game replayed in this tab: initialising the module
  // twice re-runs it for nothing.
  let wasmReady: Promise<unknown> | null = null;
  function ensureWasm(): Promise<unknown> {
    if (!wasmReady) wasmReady = initWasm().then(() => installPanicHook());
    return wasmReady;
  }

  // The engine replaying the game is the one this build ships, which is not
  // necessarily the one that played it. Stated, never blocking.
  const mismatch = $derived(buildWarning(game.app_version, __APP_VERSION__));

  let replay = $state<Replay | null>(null);
  let ply = $state(0);
  let error = $state<string | null>(null);
  let playing = $state(false);

  const view = $derived(replay ? replay.views[Math.min(ply, replay.views.length - 1)] : null);
  const lastPly = $derived(replay ? replay.views.length - 1 : 0);
  const plies = $derived(
    replay
      ? replay.views.slice(1).map((v, i) => describePly(replay!.views[i], v))
      : [],
  );

  // Rebuild the whole game whenever a different one is selected. The engine is
  // the same one that played it, so the position on screen is the position that
  // was really on the board -- not a re-derivation that could disagree.
  $effect(() => {
    const detail = game;
    let handle: Game | null = null;
    let cancelled = false;
    replay = null;
    error = null;
    playing = false;
    ply = 0;

    ensureWasm().then(
      () => {
        if (cancelled) return;
        try {
          handle = new Game(
            detail.board_size,
            detail.max_walls,
            detail.max_steps,
            detail.human_player,
          );
          const built = buildReplay(handle, detail.moves);
          replay = built;
          ply = built.views.length - 1; // open on the final position
          if (built.error) error = `Stopped at ply ${built.stoppedAt}: ${built.error}`;
        } catch (err) {
          error = String(err);
        }
      },
      (err) => {
        if (!cancelled) error = `Could not load the game engine: ${err}`;
      },
    );

    return () => {
      cancelled = true;
      handle?.free();
    };
  });

  // Autoplay. Stops itself at the end rather than looping.
  $effect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      if (ply >= lastPly) playing = false;
      else ply += 1;
    }, 700);
    return () => clearInterval(timer);
  });

  function step(delta: number) {
    playing = false;
    ply = Math.max(0, Math.min(lastPly, ply + delta));
  }

  function keydown(e: KeyboardEvent) {
    // Don't fight the filter inputs for the arrow keys.
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
    else return;
    e.preventDefault();
  }

  const mover = (m: number) => (m === game.human_player ? game.nick : "AI");
  const outcome = $derived(
    game.status !== "finished"
      ? game.status === "abandoned"
        ? "walked away"
        : "still open"
      : game.outcome === "ai_win"
        ? "AI won"
        : game.outcome === "human_win"
          ? `${game.nick} won`
          : "draw",
  );
</script>

<svelte:window onkeydown={keydown} />

<div class="replay">
  <div class="head">
    <div>
      <strong>{game.nick}</strong> vs <strong>{game.model_label}</strong>
      <small class="hint">
        {new Date(game.started_at).toLocaleString()} · {outcome} · AI played
        {game.human_player === 1 ? "first (P1)" : "second (P2)"}
      </small>
    </div>
    <dl class="params">
      <dt>sims</dt><dd>{game.mcts_n}</dd>
      <dt>c_puct</dt><dd>{game.c_puct}</dd>
      <dt>leaf par.</dt><dd>{game.leaf_parallelism}</dd>
      <dt>virtual loss</dt><dd>{game.virtual_loss}</dd>
      <dt>plies</dt><dd>{game.move_count}</dd>
      <dt>undos</dt><dd>{game.undo_count}</dd>
      <dt>webgpu</dt><dd>{game.webgpu_ok === null ? "?" : game.webgpu_ok ? "yes" : "no"}</dd>
      <dt>build</dt><dd>{game.app_version ?? "?"}</dd>
    </dl>
  </div>

  {#if mismatch}
    <p class="warn">{mismatch}</p>
  {/if}

  {#if error}
    <p class="err">{error}</p>
  {/if}

  {#if view}
    <div class="body">
      <div class="board-fit">
        <Board {view} disabled={true} onaction={() => {}} />
        <div class="controls">
          <button onclick={() => step(-lastPly)} disabled={ply === 0} title="First position">⏮</button>
          <button onclick={() => step(-1)} disabled={ply === 0} title="Previous ply (←)">◀</button>
          <button onclick={() => (playing = !playing)} disabled={ply >= lastPly && !playing}>
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>
          <button onclick={() => step(1)} disabled={ply >= lastPly} title="Next ply (→)">▶</button>
          <button onclick={() => step(lastPly)} disabled={ply >= lastPly} title="Final position">⏭</button>
          <span class="counter">ply {ply} / {lastPly}</span>
        </div>
        <input
          class="scrub"
          type="range"
          min="0"
          max={lastPly}
          value={ply}
          oninput={(e) => {
            playing = false;
            ply = +e.currentTarget.value;
          }}
        />
        <small class="hint">
          Blue at the bottom is {game.nick} (P{game.human_player + 1}); red is the AI. ← and → step
          through the game.
          {#if game.undo_count > 0}
            Takebacks are not part of this line — it is the game as it ended up.
          {/if}
        </small>
      </div>

      <ol class="plies">
        <li>
          <button class="ply" class:current={ply === 0} onclick={() => step(-lastPly)}>
            <span class="n">0</span> opening position
          </button>
        </li>
        {#each plies as p, i}
          <li>
            <button
              class="ply"
              class:current={ply === i + 1}
              onclick={() => {
                playing = false;
                ply = i + 1;
              }}
            >
              <span class="n">{i + 1}</span>
              <span class="who" class:ai={p.mover !== game.human_player}>{mover(p.mover)}</span>
              {p.text}
            </button>
          </li>
        {/each}
      </ol>
    </div>
  {:else if !error}
    <p class="hint">Loading the game engine…</p>
  {/if}
</div>

<style>
  .replay { border: 1px solid #c9b07a; border-radius: 8px; padding: 12px; background: #fffdf7; }
  /* Widen what the nested board treats as unusable width: the page's own
     padding, plus this card's border and padding, plus the board's padding. */
  .board-fit { --board-chrome: 80px; }
  .head { display: flex; gap: 20px; justify-content: space-between; flex-wrap: wrap; }
  .params {
    display: grid;
    grid-template-columns: auto auto auto auto;
    gap: 2px 8px;
    margin: 0;
    font-size: 0.78rem;
  }
  .params dt { color: #6b5a3f; }
  .params dd { margin: 0; font-variant-numeric: tabular-nums; }
  .body { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; margin-top: 10px; }
  .controls { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
  .controls button { padding: 3px 8px; }
  .counter { font-size: 0.8rem; color: #6b5a3f; font-variant-numeric: tabular-nums; }
  .scrub { width: 100%; margin-top: 6px; }
  .hint { color: #6b5a3f; display: block; font-size: 0.78rem; max-width: 34rem; }
  .err { color: #c0392b; font-size: 0.85rem; }
  .warn { color: #b45309; font-size: 0.8rem; margin: 8px 0 0; }
  .plies {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 460px;
    overflow-y: auto;
    font-size: 0.8rem;
    min-width: 15rem;
  }
  .ply {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 4px;
    padding: 2px 6px;
    cursor: pointer;
    font: inherit;
  }
  .ply:hover { background: #f6ecd6; }
  .ply.current { background: #fdf0d8; outline: 1px solid #d97706; }
  .n { color: #6b5a3f; display: inline-block; min-width: 2em; text-align: right; }
  .who { font-weight: 600; color: #1e3a8a; }
  .who.ai { color: #b91c1c; }
</style>
