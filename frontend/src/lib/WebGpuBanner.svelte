<script lang="ts">
  import type { WebGpuStatus } from "./webgpu";
  let { status }: { status: Extract<WebGpuStatus, { ok: false }> } = $props();
</script>

<!--
  Persistent by design, with no dismiss control: the condition it reports
  lasts as long as the session does, and a user who dismissed it would have no
  way to find out later why the AI is slow.
-->
<div class="banner" role="status">
  <strong>WebGPU isn't usable in this browser.</strong>
  The AI is running on the CPU instead, so it will think more slowly.
  {#if status.reason === "no-adapter"}
    Your browser supports WebGPU but offered no usable graphics adapter —
    often a blocked driver, a virtual machine, or a headless session.
  {:else if status.reason === "error"}
    Starting WebGPU failed.
  {/if}
  Pick a lower <em>Difficulty</em> if moves take too long — it runs fewer
  simulations and thinks faster.
  {#if status.detail}
    <small class="detail">{status.detail}</small>
  {/if}
</div>

<style>
  .banner {
    padding: 10px 14px;
    margin-bottom: 16px;
    border: 1px solid #d9b45a;
    border-left-width: 4px;
    border-radius: 6px;
    background: #fdf6e3;
    color: #5c4813;
    line-height: 1.5;
    font-size: 0.9rem;
  }
  .banner strong { color: #7a5c0f; }
  .detail {
    display: block;
    margin-top: 4px;
    opacity: 0.8;
    overflow-wrap: anywhere;
  }
</style>
