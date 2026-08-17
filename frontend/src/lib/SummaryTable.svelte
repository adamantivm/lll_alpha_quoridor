<script lang="ts">
  import type { GroupStats, SideStats } from "./aggregate";

  let { groups }: { groups: GroupStats[] } = $props();

  type SortKey = "games" | "aiWinRate" | "mctsN" | "cPuct" | "moves" | "lastPlayed";
  let sortKey = $state<SortKey>("games");
  let descending = $state(true);

  // groupGames() already returns the most-played order; this only re-sorts.
  const value = (g: GroupStats, key: SortKey): number | string =>
    key === "games"
      ? g.games
      : key === "aiWinRate"
        ? (g.overall.aiWinRate ?? -1)
        : key === "mctsN"
          ? g.mctsN
          : key === "cPuct"
            ? g.cPuct
            : key === "moves"
              ? (g.moves?.median ?? -1)
              : g.lastPlayed;

  const sorted = $derived(
    [...groups].sort((a, b) => {
      const av = value(a, sortKey);
      const bv = value(b, sortKey);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : av - (bv as number);
      return descending ? -cmp : cmp;
    }),
  );

  function sortBy(key: SortKey) {
    if (sortKey === key) descending = !descending;
    else {
      sortKey = key;
      descending = true;
    }
  }

  const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);
  const one = (n: number | null) => (n === null ? "—" : n.toFixed(1));
  /** "12/20 (60%)" — the fraction matters as much as the rate at these sample sizes. */
  const record = (s: SideStats) =>
    s.finished === 0 ? "—" : `${s.aiWins}/${s.finished} (${pct(s.aiWinRate)})`;
</script>

<div class="scroller">
  <table>
    <thead>
      <tr>
        <th>Model</th>
        <th class="num sortable" class:sorted={sortKey === "mctsN"} onclick={() => sortBy("mctsN")}>sims</th>
        <th class="num sortable" class:sorted={sortKey === "cPuct"} onclick={() => sortBy("cPuct")}>c_puct</th>
        <th class="num sortable" class:sorted={sortKey === "games"} onclick={() => sortBy("games")}>games</th>
        <th class="num">finished</th>
        <th class="num sortable" class:sorted={sortKey === "aiWinRate"} onclick={() => sortBy("aiWinRate")}>
          AI wins
        </th>
        <th class="num">AI as P1</th>
        <th class="num">AI as P2</th>
        <th class="num">human</th>
        <th class="num sortable" class:sorted={sortKey === "moves"} onclick={() => sortBy("moves")}>
          plies (median)
        </th>
        <th class="num">plies mean · min–max</th>
        <th class="num">plies on AI win · human win</th>
        <th class="num">leaf par.</th>
      </tr>
    </thead>
    <tbody>
      {#each sorted as g (g.key)}
        <tr>
          <td>
            <div class="label">{g.modelLabel}</div>
            <small class="hint">{g.modelId}</small>
          </td>
          <td class="num">{g.mctsN}</td>
          <td class="num">{g.cPuct}</td>
          <td class="num">
            {g.games}
            {#if g.abandoned || g.inProgress}
              <small class="hint">
                {g.abandoned} left · {g.inProgress} open
              </small>
            {/if}
          </td>
          <td class="num">{g.overall.finished}</td>
          <td class="num strong">{record(g.overall)}</td>
          <td class="num">{record(g.aiFirst)}</td>
          <td class="num">{record(g.aiSecond)}</td>
          <td class="num">{g.overall.humanWins}</td>
          <td class="num">{g.moves ? g.moves.median : "—"}</td>
          <td class="num">
            {#if g.moves}{one(g.moves.mean)} · {g.moves.min}–{g.moves.max}{:else}—{/if}
          </td>
          <td class="num">{one(g.meanMovesAiWin)} · {one(g.meanMovesHumanWin)}</td>
          <td class="num">{g.leafParallelism.join(", ")}</td>
        </tr>
      {/each}
      {#if sorted.length === 0}
        <tr><td colspan="13" class="hint">No games match these filters.</td></tr>
      {/if}
    </tbody>
  </table>
</div>

<p class="hint footnote">
  P1 is the side that moves first. Win rates count finished games only — an abandoned game has
  no result. A ply is one player's move; a game of 40 plies is 20 moves each.
</p>

<style>
  .scroller { overflow-x: auto; }
  table { border-collapse: collapse; font-size: 0.85rem; }
  th, td {
    border-bottom: 1px solid #e6dcc4;
    padding: 6px 10px;
    text-align: left;
    vertical-align: top;
    white-space: nowrap;
  }
  thead th {
    border-bottom: 2px solid #c9b07a;
    font-size: 0.78rem;
    color: #6b5a3f;
  }
  .sortable { cursor: pointer; user-select: none; }
  .sortable:hover { color: #b45309; }
  .sorted { color: #b45309; text-decoration: underline; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .strong { font-weight: 600; }
  .label { font-weight: 600; }
  .hint { color: #6b5a3f; display: block; font-size: 0.75rem; }
  .footnote { margin: 8px 0 0; font-size: 0.78rem; }
  tbody tr:hover { background: #fffaf1; }
</style>
