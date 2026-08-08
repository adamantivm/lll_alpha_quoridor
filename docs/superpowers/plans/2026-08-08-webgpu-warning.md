# WebGPU Warning (PR 2, revised) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell the user when WebGPU is unavailable and that the AI will be slower, without preventing them from playing.

**Architecture:** A capability check on the main thread decides one thing only: whether to render a persistent banner above the app. It gates nothing. The worker keeps `executionProviders: ["webgpu", "wasm"]`, so onnxruntime falls back to its wasm CPU backend on its own. Separately — and independently of that decision — the onnxruntime copy globs ship only the runtime build the worker actually requests.

**Tech Stack:** Svelte 5 (runes), Vite 5, TypeScript, vitest, `onnxruntime-web`, `quoridor-wasm` (wasm-pack).

Spec: `docs/superpowers/specs/2026-08-07-static-frontend-github-pages-design.md` ("PR 2 — Warn when WebGPU is unavailable")

## Why this plan replaces the previous one

The previous plan made WebGPU mandatory: no adapter, no app. The repo owner
then tested it and found their own Chrome — on a machine with a working GPU —
cannot run WebGPU, and confirmed with independent WebGPU test pages that the
browser's support is genuinely broken, not misdetected. A requirement that
locks the maintainer out of their own project is a bug, not a requirement.

**What survives unchanged**, because it was never the problem:

- `frontend/src/lib/webgpu.ts` and its tests. The detection was correct — the
  owner's independent testing confirmed the negative result is true. Only the
  *reaction* to it was wrong. This includes the timeout and the two-argument
  `.then` fix.
- The onnxruntime slimming (`vite.config.ts`, `check-build.mjs`). Verified
  empirically to be independent of the fallback decision: building with
  `["webgpu", "wasm"]` restored emits exactly the same filename literals in
  the worker chunk (`ort-wasm-simd-threaded.asyncify.{wasm,mjs}`), because
  the entry point and `wasmPaths` decide the filenames, not the provider list.

**What is reverted:**

- `executionProviders: ["webgpu"]` → back to `["webgpu", "wasm"]`.
- The startup gate, the "Checking for WebGPU…" state, and `UnsupportedNotice`.
- The lazy `Worker` construction in `aiClient.ts`. Its entire justification
  was "an unsupported browser should fetch no onnxruntime"; every browser now
  runs the AI, so the laziness buys nothing and the comment would be a lie.

## Global Constraints

- Node commands run via `npm --prefix frontend <cmd>` from the repo root.
- Commit messages start with `vibe: ` and an imperative subject, 50 chars max after the prefix. Body wrapped at 72 columns, explaining **why**. Do not enumerate changed files.
- Separate functional commits from formatting/lint commits.
- Branch `vibe/webgpu-required`, **rewritten in place** and retargeted from `vibe/static-frontend` (now merged) to `main`. PR #5 is reused, retitled and retargeted, not closed.
- **No new dependencies, including dev dependencies.** `@webgpu/types` stays uninstalled; `tsconfig.json` keeps admitting only `svelte` and `vite/client`.
- Do not commit `frontend/package-lock.json` or `frontend/dist/`.
- `JULIAN_NOTES.md` and `PEER_REVIEW.md` are the owner's untracked files. Leave them; never `git add -A` from the repo root.
- The banner is **persistent and not dismissible** — the condition it reports does not go away within a session.

---

## Branch rewrite mechanics

The branch currently carries eleven commits, several of which implement
behaviour we are reverting. Rewriting is cleaner than stacking reverts on
top, because a reviewer should not have to read "drop the fallback" followed
by "restore the fallback" to understand a PR that never intended to drop it.

Interactive rebase is unavailable in this environment, so:

```bash
git reset main          # mixed: HEAD to main, all PR2 content kept in the tree, unstaged
```

Then bring the tree to its final state and commit in four scoped commits.
`git reset` here rewrites only an unmerged feature branch whose PR has not
been approved; nothing depends on the old SHAs.

## File Structure

**Unchanged from the current branch state (already reviewed, keep as-is):**
- `frontend/src/lib/webgpu.ts`, `frontend/src/lib/webgpu.test.ts`
- `frontend/vite.config.ts` (the `*asyncify*` glob)
- `frontend/scripts/check-build.mjs` (the derived guard)

**Created:**
- `frontend/src/lib/WebGpuBanner.svelte` — the persistent warning.

**Modified:**
- `frontend/src/App.svelte` — no gating; render the banner above everything.
- `frontend/src/ai.worker.ts` — restore `["webgpu", "wasm"]`.
- `frontend/src/lib/aiClient.ts` — restore eager `Worker` construction.
- `frontend/README.md` — describe the fallback and record the coi-serviceworker idea.

**Deleted:**
- `frontend/src/lib/UnsupportedNotice.svelte`
- `docs/superpowers/plans/2026-08-08-webgpu-required.md` (replaced by this file)
- `docs/superpowers/results/2026-08-08-webgpu-required-results.md` (rewritten under a new name)

**Target history (four commits on top of `main`):**
1. `vibe: detect whether WebGPU is really usable` — `webgpu.ts` + tests.
2. `vibe: warn when WebGPU is unavailable` — banner, `App.svelte`, and the two reverts.
3. `vibe: copy the runtime the worker actually asks for` — glob + derived guard.
4. `vibe: write up the WebGPU warning` — README, results, plan/spec docs.

---

### Task 1: Reset the branch and restore the fallback

**Files:**
- Modify: `frontend/src/ai.worker.ts`, `frontend/src/lib/aiClient.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a tree where onnxruntime can fall back to wasm-CPU on its own, which is what lets the banner be advisory rather than a gate.

- [ ] **Step 1: Reset the branch pointer, keeping the work**

```bash
git status --short          # expect only JULIAN_NOTES.md and PEER_REVIEW.md untracked
git reset main
git status --short          # now shows every PR2 file as modified/untracked, nothing staged
```

Do NOT use `--hard`. The working tree content is the input to every step below.

- [ ] **Step 2: Restore the wasm fallback in the worker**

In `frontend/src/ai.worker.ts`, replace the `executionProviders` option and its comment:

```ts
  // WebGPU first, wasm-CPU as the fallback. Without cross-origin isolation
  // (GitHub Pages cannot send COOP/COEP) the fallback is single-threaded and
  // noticeably slower, which is what the banner in the UI warns about -- but
  // slower beats refusing to run on a browser whose WebGPU is broken.
  session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ["webgpu", "wasm"],
  });
```

- [ ] **Step 3: Restore eager Worker construction in `aiClient.ts`**

The lazy getter existed so an unsupported browser would fetch no onnxruntime.
Every browser now runs the AI, so it buys nothing. Replace the `_worker`
field and its getter with the original constructor form:

```ts
export class AiClient {
  private worker: Worker;
  onState?: (v: StateView, thinking: boolean) => void;
  onProgress?: (done: number, total: number) => void;
  onError?: (msg: string) => void;

  constructor() {
    this.worker = new Worker(new URL("../ai.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === "state") this.onState?.(m.view, m.thinking);
      else if (m.type === "progress") this.onProgress?.(m.done, m.total);
      else if (m.type === "error") this.onError?.(m.message);
    };
  }
```

Leave `newGame`, `move`, `undo` and `setParams` exactly as they are — they
already reference `this.worker`, which is now a field rather than a getter.

- [ ] **Step 4: Verify the fallback is really configured**

Run: `grep -n "executionProviders" -A2 -B4 frontend/src/ai.worker.ts`
Expected: `["webgpu", "wasm"]`, with the comment above it.

Run: `npm --prefix frontend exec svelte-check -- --threshold error`
Expected: 0 errors. (One PRE-EXISTING unrelated `Board.svelte` a11y warning.)

Do not commit yet — Task 2 completes this commit.

---

### Task 2: The banner

**Files:**
- Create: `frontend/src/lib/WebGpuBanner.svelte`
- Modify: `frontend/src/App.svelte`
- Delete: `frontend/src/lib/UnsupportedNotice.svelte`

**Interfaces:**
- Consumes: `checkWebGpu`, `WebGpuStatus` from `frontend/src/lib/webgpu.ts` (unchanged).
- Produces: the finished user-visible behaviour.

- [ ] **Step 1: Create the banner component**

Create `frontend/src/lib/WebGpuBanner.svelte`:

```svelte
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
  <strong>WebGPU isn't available in this browser.</strong>
  The AI is running on the CPU instead, so it will think more slowly.
  {#if status.reason === "no-adapter"}
    Your browser supports WebGPU but offered no usable graphics adapter —
    often a blocked driver, a virtual machine, or a headless session.
  {:else if status.reason === "error"}
    Starting WebGPU failed.
  {/if}
  Lower <em>MCTS sims</em> in the panel if moves take too long.
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
</style>
```

Note the copy does not name specific browsers. The previous version told the
user to switch to Chrome, which is unhelpful advice when their Chrome is
exactly what is broken.

- [ ] **Step 2: Delete the old refusal panel**

```bash
git rm --cached frontend/src/lib/UnsupportedNotice.svelte 2>/dev/null
rm -f frontend/src/lib/UnsupportedNotice.svelte
```

(The file is untracked-on-`main` at this point because of the reset, so
plain `rm` is what actually removes it; the `git rm --cached` is harmless
if it is not in the index.)

- [ ] **Step 3: Rewire `App.svelte`**

Read the file first. The script block currently gates startup on the check.
It must go back to starting immediately, with the check only feeding the
banner. Replace the import of `UnsupportedNotice` with `WebGpuBanner`, and
replace the gating block:

```ts
  // The check gates nothing: the worker asks for ["webgpu", "wasm"], so
  // onnxruntime falls back on its own. This only decides whether to warn.
  let gpu = $state<WebGpuStatus | null>(null);
  checkWebGpu().then(
    (status) => { gpu = status; },
    // Defensive: checkWebGpu resolves on every path today. A rejection here
    // would mean a bug in the check itself, which is not worth warning about.
    () => { gpu = { ok: true }; },
  );

  // Models are known at build time, so there is no loading state to wait for.
  newGame();
```

In the markup, render the banner above the layout and restore the ungated
board column. The whole component's structure becomes:

```svelte
{#if gpu && !gpu.ok}
  <WebGpuBanner status={gpu} />
{/if}

<div class="layout">
  <div>
    {#if error}<p class="err">Error: {error}</p>{/if}
    {#if view}
      ... unchanged status block and <Board /> ...
    {:else}
      <p>Loading…</p>
    {/if}
  </div>
  <ControlRail ... />
  <ConfigDrawer ... />
</div>
```

`ControlRail` and `ConfigDrawer` are no longer wrapped in any WebGPU
condition — they render exactly as they did before this PR.

- [ ] **Step 4: Verify no gating survives**

Run: `grep -n "UnsupportedNotice\|Checking for WebGPU\|gpu?.ok\|status.ok" frontend/src/App.svelte`
Expected: no output. Every one of those is a remnant of the gate.

- [ ] **Step 5: Verify**

```bash
npm --prefix frontend exec svelte-check -- --threshold error
npm --prefix frontend run test
npm --prefix frontend run build
npm --prefix frontend run check:build
```
Expected: 0 errors; all tests pass; build and guard succeed.

- [ ] **Step 6: Prove the banner renders, then revert the proof**

Temporarily force the failure path — change the `checkWebGpu().then(` first
handler to ignore its argument and assign
`{ ok: false, reason: "no-adapter" } as WebGpuStatus` — and run
`npm --prefix frontend run build` to confirm it compiles. Then **revert the
temporary edit** and confirm with `git diff` that it is gone. Do not commit it.

- [ ] **Step 7: Commit Tasks 1 and 2 together**

These are one behavioural change — warn instead of refuse — so they are one
commit.

```bash
git add frontend/src/lib/webgpu.ts frontend/src/lib/webgpu.test.ts
git commit -m "vibe: detect whether WebGPU is really usable

Checking for navigator.gpu is not enough: the API is present on
machines whose driver is blocklisted and in headless sessions, where
requesting an adapter is what actually fails.

The check takes the GPU object as an argument rather than reading the
global, so the failing cases can be tested without a browser, and it is
bounded by a timeout because requestAdapter can hang on a wedged GPU
process."

git add frontend/src/App.svelte frontend/src/lib/WebGpuBanner.svelte \
        frontend/src/lib/aiClient.ts frontend/src/ai.worker.ts
git rm -q --ignore-unmatch frontend/src/lib/UnsupportedNotice.svelte
git commit -m "vibe: warn when WebGPU is unavailable

Requiring WebGPU locked the maintainer out of the project: their Chrome
cannot run it despite a working GPU, and independent tests confirmed the
browser's support is genuinely broken. Broken WebGPU is common enough
that refusing to run is the wrong trade.

The check now gates nothing -- onnxruntime falls back to wasm-CPU on its
own -- so it only decides whether to warn that moves will be slower.
That also removes the startup gate, the checking state and the lazy
worker, none of which have a reason to exist once every browser plays."
```

---

### Task 3: Keep the slimmed runtime

**Files:**
- Modify: none (the working tree already holds the reviewed versions)

**Interfaces:**
- Consumes: nothing.
- Produces: `dist/` at roughly 48 MB rather than 117 MB.

The `*asyncify*` glob in `vite.config.ts` and the derived guard in
`check-build.mjs` are already correct in the working tree and were reviewed
on the previous branch. They just need committing separately, because they
are a distinct change from the banner.

- [ ] **Step 1: Confirm the slimming is still valid with the fallback restored**

This is the load-bearing check for this task. Build and inspect which
runtime filenames the worker asks for:

```bash
rm -rf frontend/dist
npm --prefix frontend run build
grep -ohE '"ort-wasm[a-zA-Z0-9._-]*\.(wasm|mjs)"' frontend/dist/assets/*.js | sort -u
ls frontend/dist/ort/
du -sh frontend/dist
```
Expected: the requested literals are `ort-wasm-simd-threaded.asyncify.mjs`
and `ort-wasm-simd-threaded.asyncify.wasm` (plus the hashed asset copy),
`dist/ort/` holds exactly those two unhashed files, and `dist/` is ~48 MB.

If the fallback caused a different runtime to be requested, STOP — the glob
would need widening and the guard would catch it. (It does not; this was
verified empirically before planning, and the guard exists to keep it true.)

- [ ] **Step 2: Confirm the guard still passes**

Run: `npm --prefix frontend run check:build`
Expected: `check:build OK (1 model(s) bundled)`.

- [ ] **Step 3: Commit**

```bash
git add frontend/vite.config.ts frontend/scripts/check-build.mjs
git commit -m "vibe: copy the runtime the worker actually asks for

Four wasm builds and every .mjs variant were being copied, 93MB of
which the app reaches about 24MB. That was a local directory before;
from the Pages deploy onward it is uploaded every time the site changes.

Which files get requested is decided by the onnxruntime entry point and
wasmPaths, not by the execution-provider list, so this holds whether or
not the wasm fallback is enabled -- verified by building both ways.

The guard derives the required filenames from the built bundle rather
than hardcoding a variant, because an earlier version of this change
hardcoded the wrong one and every check still passed."
```

---

### Task 4: Documentation and results

**Files:**
- Modify: `frontend/README.md`
- Create: `docs/superpowers/results/2026-08-08-webgpu-warning-results.md`
- Delete: `docs/superpowers/plans/2026-08-08-webgpu-required.md`, `docs/superpowers/results/2026-08-08-webgpu-required-results.md`

- [ ] **Step 1: Rewrite the README's browser section**

Read `frontend/README.md`. It currently states WebGPU is required. Replace
that section with:

```markdown
## Browser requirements

WebGPU is used when available and is much faster. When it isn't, the app
falls back to onnxruntime's wasm CPU backend and shows a banner explaining
that the AI will think more slowly — it stays playable either way. Lowering
*MCTS sims* in the config panel trades strength for speed on the CPU path.

The host must serve `dist/ort/*.mjs` with a JavaScript MIME type: onnxruntime
loads it with a dynamic `import()`, so a wrong content type fails as a
module-type error rather than a 404.

### Possible future improvement: multi-threaded CPU fallback

The CPU fallback currently runs single-threaded, because onnxruntime needs
`SharedArrayBuffer` to use threads and that requires cross-origin isolation
(COOP/COEP headers), which GitHub Pages cannot send. A service worker such as
[`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker) can
supply those headers on a static host and restore multi-threading, at the
cost of an extra service worker and a first-load reload. Deferred until
there is a measurement showing the single-threaded search is actually too
slow.
```

Also check the intro paragraph and the "How it fits together" diagram for any
remaining claim that WebGPU is mandatory, and fix them.

- [ ] **Step 2: Remove the superseded docs**

```bash
rm -f docs/superpowers/plans/2026-08-08-webgpu-required.md
rm -f docs/superpowers/results/2026-08-08-webgpu-required-results.md
```

Both describe the mandate design. The spec's PR 2 section has already been
rewritten in place with a note explaining the reversal, and git history holds
the originals.

- [ ] **Step 3: Write the results file**

Create `docs/superpowers/results/2026-08-08-webgpu-warning-results.md`,
matching the tone of `docs/superpowers/results/2026-08-07-static-frontend-results.md`
(read it first). It is the PR body, so write it for a reviewer. Cover:

- What the check does and why adapter-presence beats API-presence.
- That it gates nothing, and why that makes the design smaller.
- The reversal, told plainly: WebGPU was going to be mandatory; testing on
  the maintainer's own Chrome disproved the premise; the detection was right,
  the reaction was wrong.
- The payload reduction, and the empirical evidence that it is independent of
  the fallback decision (same filename literals either way).
- The single-threaded caveat and the deferred `coi-serviceworker` option.
- Verification output, and the open browser gate: confirm the banner appears
  *and the game is still playable* on the broken-WebGPU browser.

- [ ] **Step 4: Commit**

```bash
git add frontend/README.md docs/superpowers/
git commit -m "vibe: write up the WebGPU warning"
```

- [ ] **Step 5: Full verification sweep**

```bash
source .venv/bin/activate
PYTHONPATH=src pytest test --ignore=test/os_pz_conversion_test.py
npm --prefix frontend run test
npm --prefix frontend exec svelte-check -- --threshold error
npm --prefix frontend run build
npm --prefix frontend run check:build
```

`test/os_pz_conversion_test.py` is excluded because it fails to import on
`main` identically — the venv's `open_spiel` no longer exposes
`algorithms.alpha_zero.model`. Pre-existing and unrelated.

Read the output. Do not claim success without it.

- [ ] **Step 6: Force-push and retarget the PR**

```bash
git log --oneline main..HEAD          # expect exactly 4 commits
git push --force-with-lease origin vibe/webgpu-required
gh pr edit 5 --base main --title "vibe: warn when WebGPU is unavailable" \
  --body-file docs/superpowers/results/2026-08-08-webgpu-warning-results.md
```

`--force-with-lease` rather than `--force`: it refuses if the remote moved
since the last fetch, which is the difference between rewriting your own
branch and clobbering someone else's work.

Report the PR URL.

---

## Self-Review

**Spec coverage.** The revised spec section requires: an adapter-level check
with a timeout (already in the tree, kept by Task 1/2's first commit); the
check gating nothing with the worker keeping both providers (Task 1); a
persistent banner (Task 2); the slimming justified independently of the
fallback (Task 3, with the verification as its first step); and the
coi-serviceworker deferral recorded in the README (Task 4).

**Placeholder scan.** No TBD/TODO. Task 2 Step 3 and Task 4 Step 1 describe
edits by region rather than as whole-file pastes, because both are surgery on
files the implementer must read; the required end state is stated exactly.

**Type consistency.** `WebGpuStatus` and its `Extract<..., { ok: false }>`
narrowing are unchanged from the reviewed version and used identically in
`WebGpuBanner.svelte` and `App.svelte`. `AiClient`'s public methods keep
their signatures; only the `worker` member changes from a getter back to a
field, which is private.

**Every task leaves a green build**, with one deliberate exception: Task 1
alone does not, because deleting `UnsupportedNotice.svelte` and rewiring
`App.svelte` happen in Task 2. That is why Tasks 1 and 2 share a commit
boundary rather than each ending in one.
