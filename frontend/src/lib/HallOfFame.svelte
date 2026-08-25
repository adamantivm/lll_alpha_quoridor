<script lang="ts">
  /**
   * The last few human victories against the selected model.
   *
   * Decoration, and it behaves like it: no spinner, no error message, nothing
   * at all until there is something to say. A player came to this screen to
   * press one button, and a failed request for a wall of names is not worth
   * interrupting that.
   */
  import { RECENT_WINS_LIMIT, fetchRecentWins, statsEndpoint, type GameSummary } from "./statsApi";
  import { winSentence } from "./hallOfFame";

  let { modelId, modelLabel }: { modelId: string; modelLabel: string } = $props();

  // Empty in dev and CI builds, exactly as reporting is disabled there.
  const endpoint = statsEndpoint();

  let wins = $state<GameSummary[] | null>(null);
  let failed = $state(false);

  $effect(() => {
    const id = modelId;
    if (!endpoint) return;
    wins = null;
    failed = false;
    // A slow answer for the model that *was* selected must not land under the
    // heading of the model that is selected now.
    let current = true;
    fetchRecentWins(endpoint, id, RECENT_WINS_LIMIT, (url) => fetch(url))
      .then((rows) => { if (current) wins = rows; })
      .catch(() => { if (current) failed = true; });
    return () => { current = false; };
  });
</script>

{#if endpoint && !failed && wins !== null}
  <section class="hof">
    <h2>Recent human wins against {modelLabel}</h2>
    {#if wins.length === 0}
      <p class="none">Nobody has beaten this model yet — be the first.</p>
    {:else}
      <ul>
        {#each wins as g (g.game_id)}<li>{winSentence(g)}</li>{/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .hof {
    padding: 10px 12px;
    border: 1px solid #e0d3b8;
    border-radius: 8px;
    background: #fdf6e7;
    font-size: 0.85rem;
    color: #6b5a3f;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 0.85rem;
    font-weight: 600;
    color: #3a2412;
  }
  ul { margin: 0; padding-left: 18px; }
  li { margin: 2px 0; line-height: 1.4; }
  .none { margin: 0; }
</style>
