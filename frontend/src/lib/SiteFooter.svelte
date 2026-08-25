<script lang="ts">
  /** Shared by the play page and the stats page, so the link cannot drift. */
  const REPO_URL = "https://github.com/adamantivm/lll_alpha_quoridor";
</script>

<footer>
  Open source — <a href={REPO_URL} target="_blank" rel="noopener noreferrer">read the code on GitHub</a>.
</footer>

<style>
  footer {
    margin-top: 24px;
    padding-top: 10px;
    border-top: 1px solid #e0d3b8;
    font-size: 0.8rem;
    color: #6b5a3f;
  }
  a { color: #b45309; }
</style>
