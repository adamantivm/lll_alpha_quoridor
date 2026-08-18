<script lang="ts">
  import type { GameSummary } from "./statsApi";

  let { games, selectedId, onselect }: {
    games: GameSummary[];
    selectedId: string | null;
    onselect: (gameId: string) => void;
  } = $props();

  /** Newest first, as the API returns them. */
  const rows = $derived([...games].sort((a, b) => b.started_at.localeCompare(a.started_at)));

  const when = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

  const mmss = (ms: number) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  function result(g: GameSummary): string {
    if (g.status !== "finished") return g.status === "abandoned" ? "left" : "open";
    return g.outcome === "ai_win" ? "AI won" : g.outcome === "human_win" ? "human won" : "draw";
  }

  function keydown(e: KeyboardEvent, gameId: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onselect(gameId);
    }
  }
</script>

<div class="scroller">
  <table>
    <thead>
      <tr>
        <th>when</th>
        <th>player</th>
        <th>model</th>
        <th class="num">sims</th>
        <th class="num">c_puct</th>
        <th>AI seat</th>
        <th>result</th>
        <th class="num">plies</th>
        <th class="num">undos</th>
        <th class="num">time</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as g (g.game_id)}
        <tr
          class:selected={g.game_id === selectedId}
          role="button"
          tabindex="0"
          aria-pressed={g.game_id === selectedId}
          title="Replay this game"
          onclick={() => onselect(g.game_id)}
          onkeydown={(e) => keydown(e, g.game_id)}
        >
          <td>{when(g.started_at)}</td>
          <td>{g.nick}</td>
          <td>{g.model_label}</td>
          <td class="num">{g.mcts_n}</td>
          <td class="num">{g.c_puct}</td>
          <!-- The AI moves first exactly when the human chose to move second. -->
          <td>{g.human_player === 1 ? "P1" : "P2"}</td>
          <td class:win={g.outcome === "ai_win"} class:loss={g.outcome === "human_win"}>
            {result(g)}
          </td>
          <td class="num">{g.move_count}</td>
          <td class="num">{g.undo_count || ""}</td>
          <td class="num">{mmss(g.duration_ms)}</td>
        </tr>
      {/each}
      {#if rows.length === 0}
        <tr><td colspan="10" class="empty">No games match these filters.</td></tr>
      {/if}
    </tbody>
  </table>
</div>

<style>
  .scroller { overflow: auto; max-height: 60vh; border: 1px solid #e6dcc4; border-radius: 6px; }
  table { border-collapse: collapse; font-size: 0.82rem; width: 100%; }
  th, td { padding: 5px 9px; text-align: left; white-space: nowrap; }
  thead th {
    position: sticky;
    top: 0;
    background: #fffaf1;
    border-bottom: 2px solid #c9b07a;
    font-size: 0.75rem;
    color: #6b5a3f;
  }
  tbody tr { cursor: pointer; border-bottom: 1px solid #f0e8d6; }
  tbody tr:hover { background: #fffaf1; }
  tbody tr.selected { background: #fdf0d8; outline: 2px solid #d97706; outline-offset: -2px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .win { color: #b91c1c; font-weight: 600; }
  .loss { color: #1e3a8a; font-weight: 600; }
  .empty { color: #6b5a3f; }
</style>
