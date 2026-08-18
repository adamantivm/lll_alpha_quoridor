<script lang="ts">
  import GameList from "./lib/GameList.svelte";
  import Replay from "./lib/Replay.svelte";
  import SummaryTable from "./lib/SummaryTable.svelte";
  import {
    DEFAULT_FILTERS,
    MIN_PLIES,
    applyFilters,
    dropTrivial,
    groupGames,
    totals,
    type Filters,
  } from "./lib/aggregate";
  import { createGameSelector } from "./lib/selectGame";
  import {
    MAX_ROWS,
    fetchAllGames,
    fetchGame,
    statsEndpoint,
    type GameDetail,
    type GameStatus,
    type GameSummary,
  } from "./lib/statsApi";

  const endpoint = statsEndpoint();

  let games = $state<GameSummary[]>([]);
  let trivial = $state(0);
  let loading = $state(true);
  let truncated = $state(false);
  let error = $state<string | null>(null);
  let filters = $state<Filters>({ ...DEFAULT_FILTERS });

  let selectedId = $state<string | null>(null);
  let selected = $state<GameDetail | null>(null);
  let selectError = $state<string | null>(null);

  const shown = $derived(applyFilters(games, filters));
  const groups = $derived(groupGames(shown));
  const overall = $derived(totals(games));
  const nicks = $derived([...new Set(games.map((g) => g.nick))].sort());
  const versions = $derived(
    [...new Set(games.map((g) => g.app_version).filter((v): v is string => v !== null))].sort(),
  );
  /** id -> label, so the picker reads like the play page's model list. */
  const models = $derived(
    [...new Map(games.map((g) => [g.model_id, g.model_label]))].sort((a, b) =>
      a[0].localeCompare(b[0]),
    ),
  );

  const fetchImpl = (url: string) => fetch(url);

  async function load() {
    if (!endpoint) {
      loading = false;
      return;
    }
    try {
      const result = await fetchAllGames(endpoint, fetchImpl);
      // Barely-started games are dropped here rather than in the filters: they
      // are not a view of the data anyone wants, so they should not be in the
      // headline counts either.
      games = dropTrivial(result.games);
      trivial = result.games.length - games.length;
      truncated = result.truncated;
      // A link to one game replays that game: /stats.html?game=<id>.
      const wanted = new URLSearchParams(location.search).get("game");
      if (wanted) select(wanted);
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
    } finally {
      loading = false;
    }
  }

  // Clicking through the list faster than the network answers must not leave
  // an older game on screen: the selector drops everything but the newest.
  const loadSelection = createGameSelector((gameId) => fetchGame(endpoint, gameId, fetchImpl), {
    setGame: (g) => (selected = g),
    setError: (m) => (selectError = m),
  });

  function select(gameId: string) {
    selectedId = gameId;
    // Shareable without reloading, and the back button still leaves the page.
    const url = new URL(location.href);
    url.searchParams.set("game", gameId);
    history.replaceState(null, "", url);
    void loadSelection(gameId);
  }

  function clearSelection() {
    selectedId = null;
    selected = null;
    selectError = null;
    const url = new URL(location.href);
    url.searchParams.delete("game");
    history.replaceState(null, "", url);
  }

  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

  load();
</script>

<header>
  <h1>Quoridor — games played</h1>
  <a href="./">← Play a game</a>
</header>

{#if !endpoint}
  <p class="note">
    This build has no stats endpoint configured, so there is nothing to show. Set
    <code>VITE_STATS_ENDPOINT</code> at build time (the deployed site gets it from the
    <code>STATS_ENDPOINT</code> repository variable — see <code>stats-worker/README.md</code>).
  </p>
{:else if loading}
  <p class="note">Loading games…</p>
{:else if error}
  <p class="err">Could not reach the stats API: {error}</p>
{:else if games.length === 0}
  <p class="note">No games have been recorded yet.</p>
{:else}
  <p class="totals">
    <strong>{overall.games}</strong> games · {overall.finished} finished ·
    {overall.abandoned} walked away · {overall.inProgress} open ·
    {overall.players} player{overall.players === 1 ? "" : "s"} ·
    {overall.models} model{overall.models === 1 ? "" : "s"} ·
    {day(overall.first)} – {day(overall.last)}
    {#if trivial > 0}
      <br /><small class="hint">
        {trivial} game{trivial === 1 ? "" : "s"} of under {MIN_PLIES} plies not counted — someone
        opened the page and left.
      </small>
    {/if}
    {#if truncated}
      <br /><small class="warn">
        Showing the most recent {MAX_ROWS} games only — the rest are in the database.
      </small>
    {/if}
  </p>

  <fieldset class="filters">
    <legend>Filters</legend>
    <label class="check">
      <input type="checkbox" bind:checked={filters.excludeUndos} />
      Exclude games with takebacks
    </label>
    <label>
      Player
      <select
        value={filters.nick ?? ""}
        onchange={(e) => (filters.nick = e.currentTarget.value || null)}
      >
        <option value="">everyone</option>
        {#each nicks as n}<option value={n}>{n}</option>{/each}
      </select>
    </label>
    <label>
      Status
      <select
        value={filters.status ?? ""}
        onchange={(e) => (filters.status = (e.currentTarget.value || null) as GameStatus | null)}
      >
        <option value="">any</option>
        <option value="finished">finished</option>
        <option value="abandoned">walked away</option>
        <option value="in_progress">open</option>
      </select>
    </label>
    <label>
      Model
      <select
        value={filters.modelId ?? ""}
        onchange={(e) => (filters.modelId = e.currentTarget.value || null)}
      >
        <option value="">any</option>
        {#each models as [id, label]}<option value={id}>{label}</option>{/each}
      </select>
    </label>
    <label>
      Build
      <select
        value={filters.appVersion ?? ""}
        onchange={(e) => (filters.appVersion = e.currentTarget.value || null)}
      >
        <option value="">any</option>
        {#each versions as v}<option value={v}>{v}</option>{/each}
      </select>
    </label>
    <span class="count">{shown.length} of {games.length} games</span>
  </fieldset>

  <h2>By model, sims and c_puct</h2>
  <SummaryTable {groups} />

  <h2>Games</h2>
  <p class="hint">Pick a game to replay it.</p>
  <GameList games={shown} {selectedId} onselect={select} />

  {#if selectError}
    <p class="err">{selectError}</p>
  {/if}
  {#if selected}
    <div class="replay-head">
      <h2>Replay</h2>
      <button onclick={clearSelection}>Close</button>
    </div>
    <Replay game={selected} />
  {:else if selectedId && !selectError}
    <p class="note">Loading that game…</p>
  {/if}
{/if}

<style>
  header { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
  h1 { font-size: 1.35rem; margin: 0 0 6px; }
  h2 { font-size: 1rem; margin: 22px 0 8px; }
  a { color: #b45309; }
  .note, .totals, .hint { color: #6b5a3f; font-size: 0.85rem; }
  .totals { font-size: 0.9rem; color: #3a2412; }
  .warn { color: #b45309; }
  .err { color: #c0392b; }
  code { background: #f6ecd6; padding: 0 3px; border-radius: 3px; }
  .filters {
    display: flex;
    align-items: flex-end;
    gap: 14px;
    flex-wrap: wrap;
    border: 1px solid #e6dcc4;
    border-radius: 6px;
    padding: 8px 12px 10px;
    font-size: 0.82rem;
  }
  legend { color: #6b5a3f; font-size: 0.75rem; padding: 0 4px; }
  .filters label { display: flex; flex-direction: column; gap: 2px; color: #6b5a3f; }
  .filters label.check { flex-direction: row; align-items: center; gap: 6px; color: inherit; }
  .count { color: #6b5a3f; margin-left: auto; }
  .replay-head { display: flex; align-items: center; gap: 12px; }
  .replay-head h2 { margin-bottom: 8px; }
</style>
