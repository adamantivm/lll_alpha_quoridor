# Static Frontend (PR 1: Statification) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Quoridor frontend a purely static site that needs no server, and delete the Python play server.

**Architecture:** Per-model directories under `frontend/models/<id>/` hold `model.onnx` plus a `meta.json` describing the board and MCTS defaults. A Vite `import.meta.glob` collects the metadata at build time, replacing `GET /api/config` and `GET /api/models`; `vite-plugin-static-copy` copies the model directories into `dist/models/`, replacing `GET /models/*.onnx`. A relative Vite base (`base: "./"`) plus one URL-resolution function on the main thread makes the build work under any path prefix, including a GitHub project page.

**Tech Stack:** Svelte 5 (runes), Vite 5, TypeScript, vitest, `onnxruntime-web`, `quoridor-wasm` (wasm-pack), Python 3.12 (trainer only, after this PR).

Spec: `docs/superpowers/specs/2026-08-07-static-frontend-github-pages-design.md`

## Global Constraints

- Node commands run via `npm --prefix frontend <cmd>` from the repo root.
- `npm install`, never `npm ci`: the lockfile resolves `quoridor-wasm` by relative path against the `pkg/` directory `wasm-pack` produces, so `wasm-pack build rust/quoridor-wasm --target web --release` must run first.
- Python work needs the venv: `source .venv/bin/activate`.
- Commit messages start with `vibe: ` and an imperative subject, 50 chars max after the prefix. Body wrapped at 72 columns, explaining **why**. Do not enumerate changed files.
- Separate functional commits from formatting/lint commits.
- Branch `vibe/static-frontend`, branched from `main`. Never commit to `main`.
- Metadata field names are `snake_case` (`board_size`, `max_walls`, `max_steps`, `mcts_n`, `mcts_c_puct`, `leaf_parallelism`, `virtual_loss`) to match the existing Python config vocabulary. TypeScript locals stay `camelCase`.
- No new runtime dependencies. `vite-plugin-static-copy` is already present.

---

## File Structure

**Created:**
- `frontend/models/b5w2-mv1/model.onnx` — copy of `rust/fixtures/alphazero_B5W2_mv1.onnx`.
- `frontend/models/b5w2-mv1/meta.json` — board dims + MCTS defaults for that model.
- `frontend/src/lib/models.ts` — the whole static-metadata layer: types, validation, the glob, default selection, URL resolution. Replaces `api.ts`.
- `frontend/src/lib/models.test.ts` — unit tests for the pure functions in `models.ts`.
- `frontend/scripts/check-build.mjs` — post-build assertions guarding the base-path and copy-target regressions.

**Modified:**
- `.gitignore` — negate `models/` for `frontend/models/`.
- `frontend/vite.config.ts` — `base: "./"`, copy `models/*`, drop COOP/COEP dev headers.
- `frontend/package.json` — add the `check:build` script.
- `frontend/src/App.svelte` — synchronous models, `$derived` board dims, model switching restarts the game.
- `frontend/src/lib/ConfigDrawer.svelte` — `ModelEntry[]` instead of `ConfigView`/`ModelsView`, show labels.
- `frontend/src/lib/aiClient.ts` — `newGame` takes `modelUrl` + `ortBase`.
- `frontend/src/ai.worker.ts` — no hardcoded paths; URLs arrive by message.
- `README.md`, `frontend/README.md` — static build/serve instructions.
- `requirements.txt`, `ci_requirements.txt` — drop `fastapi`, `uvicorn`, `httpx`.

**Deleted:**
- `frontend/src/lib/api.ts`, `frontend/src/lib/api.test.ts`
- `src/run_play_server_web.py`
- `src/v2/play_server_web/` (whole package)
- `test/test_play_server_web.py`

**Task order rationale:** Task 1 establishes the data on disk (nothing depends on code). Task 2 builds `models.ts` bottom-up with tests, since every later task consumes its types. Task 3 wires the build. Task 4 rewires the UI. Task 5 rewires the worker — after which the app works end-to-end. Task 6 deletes the server. Task 7 adds the build guard and docs.

---

### Task 1: Model directory and gitignore fix

**Files:**
- Create: `frontend/models/b5w2-mv1/model.onnx`, `frontend/models/b5w2-mv1/meta.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: the on-disk layout `frontend/models/<id>/{model.onnx,meta.json}` that Tasks 2 and 3 glob and copy. Model id for this PR is exactly `b5w2-mv1`.

- [ ] **Step 1: Prove the gitignore problem exists**

Run:
```bash
mkdir -p frontend/models/b5w2-mv1
touch frontend/models/b5w2-mv1/model.onnx
git check-ignore -v frontend/models/b5w2-mv1/model.onnx
```
Expected: prints `.gitignore:48:models/	frontend/models/b5w2-mv1/model.onnx`.

That line exists for training output (`runs/*/models/`), but the pattern
matches a directory named `models` at any depth, so it swallows the
frontend's bundled models too. Without the next step, `git add` silently
adds nothing and the deployed site has an empty model picker.

- [ ] **Step 2: Add the negation**

Append to `.gitignore`, immediately after the `models/` line in the
"Training output and experiment tracking" block:

```gitignore
# The training-output models/ rule above matches a directory of that name at
# any depth, which would swallow the frontend's bundled play models.
!frontend/models/
```

- [ ] **Step 3: Verify the negation is surgical**

Run:
```bash
git check-ignore -v frontend/models/b5w2-mv1/model.onnx || echo "frontend: NOT ignored (good)"
mkdir -p runs/tmpcheck/models && touch runs/tmpcheck/models/m.onnx
git check-ignore -q runs/tmpcheck/models/m.onnx && echo "training: still ignored (good)"
mkdir -p models && touch models/other.onnx
git check-ignore -q models/other.onnx && echo "top-level models/: still ignored (good)"
rm -rf runs/tmpcheck models
```
Expected: all three "(good)" lines print.

- [ ] **Step 4: Add the real model and its metadata**

```bash
cp rust/fixtures/alphazero_B5W2_mv1.onnx frontend/models/b5w2-mv1/model.onnx
```

`rust/fixtures/` keeps its copy — it is a Rust test fixture with a different
lifecycle, and pointing the frontend build at it would break the build if it
were ever moved.

Create `frontend/models/b5w2-mv1/meta.json`:

```json
{
  "label": "5×5, 2 walls (mv1)",
  "default": true,
  "board_size": 5,
  "max_walls": 2,
  "max_steps": 50,
  "defaults": {
    "mcts_n": 200,
    "mcts_c_puct": 1.4,
    "leaf_parallelism": 8,
    "virtual_loss": 1
  }
}
```

Those values come from the play-directory config in `README.md` (board 5,
2 walls, 50 steps, `mcts_n: 200`, `mcts_c_puct: 1.4`) and from the
`leaf_parallelism: 8` / `virtual_loss: 1` currently hardcoded as initial
`params` in `App.svelte`.

- [ ] **Step 5: Verify both files are stageable**

Run: `git add -n frontend/models/`
Expected: lists both `meta.json` and `model.onnx`.

- [ ] **Step 6: Commit**

```bash
git add .gitignore frontend/models/
git commit -m "vibe: bundle a play model as static frontend data

The frontend is about to read its board settings and model list from
files on disk instead of the play server's JSON API, so the model and
its settings have to live somewhere the build can see.

The training-output models/ ignore rule matches that directory name at
any depth and silently swallowed the new directory, so it needs the same
kind of negation the Python template's lib/ rule already has."
```

---

### Task 2: The `models.ts` metadata layer

**Files:**
- Create: `frontend/src/lib/models.ts`, `frontend/src/lib/models.test.ts`

`api.ts` stays for now, unused, and is deleted in Task 4 together with its
last two importers. Deleting it here would leave the build red across a
commit for no benefit.

**Interfaces:**
- Consumes: the Task 1 directory layout.
- Produces, for Tasks 3–5:
  - `interface ModelDefaults { mcts_n: number; mcts_c_puct: number; leaf_parallelism: number; virtual_loss: number }`
  - `interface ModelEntry { id: string; label: string; isDefault: boolean; board_size: number; max_walls: number; max_steps: number; defaults: ModelDefaults }`
  - `parseMeta(id: string, raw: unknown): ModelEntry`
  - `buildEntries(globbed: Record<string, unknown>): ModelEntry[]`
  - `pickDefault(entries: ModelEntry[]): ModelEntry`
  - `joinUrl(base: string, path: string): string`
  - `siteBase(): string`
  - `modelUrl(entry: ModelEntry): string`
  - `ortBase(): string`
  - `MODELS: ModelEntry[]`

Note the split: `parseMeta`, `buildEntries`, `pickDefault` and `joinUrl` are
pure and take everything as arguments, so they are testable under vitest's
default `node` environment where `location` and `import.meta.env.BASE_URL`
are not meaningful. Only `siteBase`, `modelUrl` and `ortBase` touch browser
globals, and they are thin wrappers over `joinUrl`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/models.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildEntries, joinUrl, parseMeta, pickDefault, type ModelEntry } from "./models";

const raw = {
  label: "5×5, 2 walls (mv1)",
  default: true,
  board_size: 5,
  max_walls: 2,
  max_steps: 50,
  defaults: { mcts_n: 200, mcts_c_puct: 1.4, leaf_parallelism: 8, virtual_loss: 1 },
};

function entry(id: string, over: Partial<ModelEntry> = {}): ModelEntry {
  return { ...parseMeta(id, raw), ...over };
}

describe("parseMeta", () => {
  it("maps a valid meta onto a ModelEntry", () => {
    const e = parseMeta("b5w2-mv1", raw);
    expect(e.id).toBe("b5w2-mv1");
    expect(e.label).toBe("5×5, 2 walls (mv1)");
    expect(e.isDefault).toBe(true);
    expect(e.board_size).toBe(5);
    expect(e.defaults.mcts_n).toBe(200);
  });

  it("defaults isDefault to false when the key is absent", () => {
    const { default: _omit, ...noFlag } = raw;
    expect(parseMeta("x", noFlag).isDefault).toBe(false);
  });

  it("names the model and the field when a field is missing", () => {
    const { max_walls: _omit, ...broken } = raw;
    expect(() => parseMeta("b9w10", broken)).toThrow(/b9w10.*max_walls/);
  });

  it("names the model and the field when a field has the wrong type", () => {
    expect(() => parseMeta("b9w10", { ...raw, board_size: "five" })).toThrow(
      /b9w10.*board_size/,
    );
  });

  it("rejects a missing defaults block", () => {
    const { defaults: _omit, ...broken } = raw;
    expect(() => parseMeta("b9w10", broken)).toThrow(/b9w10.*defaults/);
  });
});

describe("buildEntries", () => {
  it("derives ids from the directory name and sorts by id", () => {
    const entries = buildEntries({
      "../../models/zzz/meta.json": raw,
      "../../models/aaa/meta.json": raw,
    });
    expect(entries.map((e) => e.id)).toEqual(["aaa", "zzz"]);
  });

  it("throws when there are no models at all", () => {
    expect(() => buildEntries({})).toThrow(/no models/i);
  });
});

describe("pickDefault", () => {
  it("prefers the entry flagged default", () => {
    const entries = [entry("aaa"), entry("zzz", { isDefault: false })];
    expect(pickDefault(entries).id).toBe("aaa");
  });

  it("falls back to the last by id when nothing is flagged", () => {
    const entries = [entry("aaa", { isDefault: false }), entry("zzz", { isDefault: false })];
    expect(pickDefault(entries).id).toBe("zzz");
  });

  it("falls back to the last by id when several are flagged", () => {
    const entries = [entry("aaa"), entry("zzz")];
    expect(pickDefault(entries).id).toBe("zzz");
  });
});

describe("joinUrl", () => {
  it("resolves against a subpath base, as a GitHub project page serves", () => {
    expect(joinUrl("http://h/lll_alpha_quoridor/", "models/b5w2-mv1/model.onnx")).toBe(
      "http://h/lll_alpha_quoridor/models/b5w2-mv1/model.onnx",
    );
  });

  it("resolves against a root base", () => {
    expect(joinUrl("http://h/", "ort/")).toBe("http://h/ort/");
  });

  it("does not let a path escape the base", () => {
    expect(joinUrl("http://h/sub/", "models/x/model.onnx")).toContain("/sub/models/");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix frontend run test`
Expected: FAIL — `Failed to resolve import "./models"`.

- [ ] **Step 3: Implement `models.ts`**

Create `frontend/src/lib/models.ts`:

```ts
/**
 * The frontend's model catalogue, replacing the play server's /api/config and
 * /api/models. Metadata is collected from frontend/models/<id>/meta.json at
 * build time; the matching .onnx files are copied to dist/models/ by
 * vite-plugin-static-copy (see vite.config.ts).
 */

export interface ModelDefaults {
  mcts_n: number;
  mcts_c_puct: number;
  leaf_parallelism: number;
  virtual_loss: number;
}

export interface ModelEntry {
  id: string;
  label: string;
  isDefault: boolean;
  board_size: number;
  max_walls: number;
  max_steps: number;
  defaults: ModelDefaults;
}

function req<T>(id: string, obj: Record<string, unknown>, key: string, kind: "number" | "string"): T {
  const v = obj[key];
  if (typeof v !== kind) {
    throw new Error(
      `model "${id}": meta.json field "${key}" must be a ${kind}, got ${JSON.stringify(v)}`,
    );
  }
  return v as T;
}

/** Validate one meta.json body into a ModelEntry, or throw naming the model and field. */
export function parseMeta(id: string, raw: unknown): ModelEntry {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`model "${id}": meta.json must contain an object`);
  }
  const o = raw as Record<string, unknown>;
  const d = o.defaults;
  if (typeof d !== "object" || d === null) {
    throw new Error(`model "${id}": meta.json field "defaults" must be an object`);
  }
  const dd = d as Record<string, unknown>;
  return {
    id,
    label: req<string>(id, o, "label", "string"),
    isDefault: o.default === true,
    board_size: req<number>(id, o, "board_size", "number"),
    max_walls: req<number>(id, o, "max_walls", "number"),
    max_steps: req<number>(id, o, "max_steps", "number"),
    defaults: {
      mcts_n: req<number>(id, dd, "mcts_n", "number"),
      mcts_c_puct: req<number>(id, dd, "mcts_c_puct", "number"),
      leaf_parallelism: req<number>(id, dd, "leaf_parallelism", "number"),
      virtual_loss: req<number>(id, dd, "virtual_loss", "number"),
    },
  };
}

/** Turn a glob result keyed by meta.json path into id-sorted entries. */
export function buildEntries(globbed: Record<string, unknown>): ModelEntry[] {
  const entries = Object.entries(globbed).map(([path, raw]) => {
    const m = /([^/]+)\/meta\.json$/.exec(path);
    if (!m) throw new Error(`unexpected model metadata path: ${path}`);
    return parseMeta(m[1], raw);
  });
  if (entries.length === 0) {
    throw new Error("no models found under frontend/models/*/meta.json");
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

/** The entry flagged `"default": true`, else the last by id (highest version). */
export function pickDefault(entries: ModelEntry[]): ModelEntry {
  const flagged = entries.filter((e) => e.isDefault);
  return flagged.length === 1 ? flagged[0] : entries[entries.length - 1];
}

/** Resolve `path` against `base`. Both models and ORT's runtime go through here. */
export function joinUrl(base: string, path: string): string {
  return new URL(path, base).href;
}

/**
 * The absolute URL this site is mounted at. Vite's base is "./", so this
 * works at the root, under a GitHub project page's /<repo>/ prefix, or under
 * a custom domain, with no configuration.
 */
export function siteBase(): string {
  return new URL(import.meta.env.BASE_URL, location.href).href;
}

export const MODELS: ModelEntry[] = buildEntries(
  import.meta.glob("../../models/*/meta.json", { eager: true, import: "default" }),
);

export function modelUrl(entry: ModelEntry): string {
  return joinUrl(siteBase(), `models/${entry.id}/model.onnx`);
}

export function ortBase(): string {
  return joinUrl(siteBase(), "ort/");
}
```

The glob is `../../models/...`: from `frontend/src/lib/`, one `..` reaches
`frontend/src/`, two reach `frontend/`. `import: "default"` makes each value
the parsed JSON object rather than a module namespace.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix frontend run test`
Expected: PASS — the new `models` suite plus the pre-existing `api`,
`boardGrid`, `evalRunner` and `smoke` suites. The tree still builds: nothing
has been removed yet.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/models.ts frontend/src/lib/models.test.ts
git commit -m "vibe: read model settings from disk, not an API

Board dimensions and MCTS defaults came from the play server's
/api/config, which is the only reason the app needed a server at all.
Collecting them from per-model meta.json files at build time removes
that dependency and lets models with different board sizes coexist,
which one shared config.yaml could never express.

The pure functions take their inputs as arguments so they can be tested
without a DOM; only the three URL helpers touch browser globals.

Fields the UI never read (temperature, the MCTS noise knobs, worker
threads) are self-play training settings with no meaning at inference
time, so they do not come along."
```

---

### Task 3: Build wiring

**Files:**
- Modify: `frontend/vite.config.ts`

**Interfaces:**
- Consumes: Task 1's `frontend/models/<id>/` layout.
- Produces: `dist/models/<id>/model.onnx` and `dist/ort/*.wasm` in the build output, and a relative asset base so the build works under any path prefix.

- [ ] **Step 1: Rewrite `vite.config.ts`**

Replace the entire contents of `frontend/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteStaticCopy } from "vite-plugin-static-copy";

// A relative base makes the build work at the root, under a GitHub project
// page's /<repo>/ prefix, or under a custom domain, with no rebuild. All URL
// resolution funnels through siteBase() in src/lib/models.ts.
export default defineConfig({
  base: "./",
  plugins: [
    svelte(),
    viteStaticCopy({
      targets: [
        // ORT constructs these filenames internally, so Vite cannot resolve
        // them for us; they are copied verbatim and located via ortBase().
        { src: "node_modules/onnxruntime-web/dist/*.wasm", dest: "ort" },
        { src: "node_modules/onnxruntime-web/dist/*.mjs", dest: "ort" },
        // Whole model directories, so meta.json ships next to its model and
        // the deployed site is self-describing. Only the .onnx is fetched at
        // runtime; the metadata is inlined into the bundle at build time.
        { src: "models/*", dest: "models" },
      ],
    }),
  ],
  worker: { format: "es" },
});
```

Two removals worth being explicit about. The `server.headers` block that set
`Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` is gone:
GitHub Pages cannot set response headers, so cross-origin isolation is
unreachable in production, and keeping it in dev would make dev diverge from
prod. The consequence is that ORT's wasm-CPU fallback now runs
single-threaded locally, which is the honest preview of what Pages gives.
PR 2 removes that fallback entirely.

- [ ] **Step 2: Build and verify the output layout**

Run:
```bash
wasm-pack build rust/quoridor-wasm --target web --release
npm --prefix frontend install
npm --prefix frontend run build
```
Expected: the build succeeds. Then verify the new output layout:

```bash
ls frontend/dist/models/b5w2-mv1/
ls frontend/dist/ort/ | head -3
grep -o 'src="[^"]*"' frontend/dist/index.html
```
Expected: `meta.json` and `model.onnx` in the first; `.wasm`/`.mjs` files in
the second; a **relative** `src="./assets/..."` in the third, not `src="/assets/..."`.

The app still fetches `/api/config` at this point, so it will not run yet —
Task 4 rewires it. The build output is what this task is responsible for.

- [ ] **Step 3: Commit**

```bash
git add frontend/vite.config.ts
git commit -m "vibe: emit models into the build, relative to base

The .onnx files were served by the Python app; copying them into the
build is what lets any static host serve the game.

A relative base is what makes a GitHub project page work: it is served
from /<repo>/, where root-absolute asset URLs 404. Relative also keeps
the same build working at the root and under a custom domain.

Cross-origin isolation goes away because GitHub Pages cannot set
response headers, so keeping it in dev would only hide the difference
until deploy day."
```

---

### Task 4: Rewire the UI

**Files:**
- Modify: `frontend/src/App.svelte`, `frontend/src/lib/ConfigDrawer.svelte`, `frontend/src/lib/aiClient.ts`
- Delete: `frontend/src/lib/api.ts`, `frontend/src/lib/api.test.ts`

**Interfaces:**
- Consumes: `MODELS`, `ModelEntry`, `pickDefault`, `modelUrl`, `ortBase` from Task 2.
- Produces: `App.svelte` calls `ai.newGame({ modelUrl, ortBase, boardSize, maxWalls, maxSteps, humanPlayer, params })` — the shape Task 5's `aiClient` must accept.

- [ ] **Step 1: Rewrite the script block of `App.svelte`**

In `frontend/src/App.svelte`, replace everything from `import { onMount }` through the end of the `act` function (i.e. the whole `<script lang="ts">` body) with:

```ts
  import Board from "./lib/Board.svelte";
  import ControlRail from "./lib/ControlRail.svelte";
  import ConfigDrawer from "./lib/ConfigDrawer.svelte";
  import { AiClient } from "./lib/aiClient";
  import { MODELS, modelUrl, ortBase, pickDefault, type ModelEntry } from "./lib/models";
  import type { StateView } from "./lib/types";

  const initial = pickDefault(MODELS);

  let selected = $state<ModelEntry>(initial);
  let view = $state<StateView | null>(null);
  let thinking = $state(false);
  let progress = $state<{ done: number; total: number } | null>(null);
  let error = $state<string | null>(null);
  let humanPlayer = $state(0);
  let params = $state({
    mctsN: initial.defaults.mcts_n,
    cPuct: initial.defaults.mcts_c_puct,
    leafParallelism: initial.defaults.leaf_parallelism,
    virtualLoss: initial.defaults.virtual_loss,
  });

  // True only when the human may act: their turn, game live, AI not working.
  const awaitingHuman = $derived(
    !!view && view.winner == null && view.current_player === view.human_player && !thinking,
  );

  const ai = new AiClient();
  ai.onState = (v, t) => { view = v; thinking = t; if (!t) progress = null; };
  ai.onProgress = (done, total) => { thinking = true; progress = { done, total }; };
  ai.onError = (m) => { error = m; thinking = false; };

  // Models are known at build time, so there is no loading state to wait for.
  newGame();

  function newGame() {
    error = null; thinking = true; progress = null;
    ai.newGame({
      modelUrl: modelUrl(selected), ortBase: ortBase(),
      boardSize: selected.board_size, maxWalls: selected.max_walls,
      maxSteps: selected.max_steps, humanPlayer, params,
    });
  }

  // Switching models can change the board, so it has to restart the game
  // rather than swap the network under a position that may not be legal.
  function selectModel(entry: ModelEntry) {
    if (entry.id === selected.id) return;
    selected = entry;
    params = {
      ...params,
      mctsN: entry.defaults.mcts_n,
      cPuct: entry.defaults.mcts_c_puct,
    };
    newGame();
  }

  function act(index: number) { thinking = true; ai.move(index); }
```

`onMount` is gone: `MODELS` is a build-time constant, so the game can start
immediately.

- [ ] **Step 2: Update the markup of `App.svelte`**

In the same file, replace the `<ConfigDrawer ... />` element with:

```svelte
  <ConfigDrawer models={MODELS} {selected} {params} {humanPlayer}
    onmodel={selectModel}
    onparams={(p) => { params = p; ai.setParams(p); }}
    onhumanplayer={(p) => { humanPlayer = p; }} />
```

Leave the `{#if view}` block, `Board`, `ControlRail` and the `<style>` block
exactly as they are. The `{:else}<p>Loading…</p>` arm stays — `view` is still
null for the moment between `newGame()` and the worker's first state message.

- [ ] **Step 3: Update `ConfigDrawer.svelte`**

In `frontend/src/lib/ConfigDrawer.svelte`, replace the `<script>` block with:

```svelte
<script lang="ts">
  import type { ModelEntry } from "./models";
  type Params = { mctsN: number; cPuct: number; leafParallelism: number; virtualLoss: number };
  let { models, selected, params, humanPlayer, onmodel, onparams, onhumanplayer }: {
    models: ModelEntry[];
    selected: ModelEntry;
    params: Params;
    humanPlayer: number;
    onmodel: (entry: ModelEntry) => void;
    onparams: (params: Params) => void;
    onhumanplayer: (p: number) => void;
  } = $props();
</script>
```

Splitting `onchange` into `onmodel` and `onparams` matters: a model change now
restarts the game, while a slider change only retunes the running search.
Under the old combined callback the parent could not tell them apart.

Replace the model `<label>` with:

```svelte
  <label>Model
    <select value={selected.id}
      onchange={(e) => {
        const m = models.find((x) => x.id === e.currentTarget.value);
        if (m) onmodel(m);
      }}>
      {#each models as m}<option value={m.id}>{m.label}</option>{/each}
    </select>
  </label>
  <small class="hint">{selected.board_size}×{selected.board_size} board, {selected.max_walls} walls each. Switching starts a new game.</small>
```

Replace each of the three slider `oninput` handlers to call `onparams`:

```svelte
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
```

Leave the "You play" segmented control and the `<style>` block unchanged.

- [ ] **Step 4: Update `aiClient.ts` to accept the new call shape**

`aiClient` is the typed seam between `App.svelte` and the worker, so its
signature has to move with its caller — otherwise `svelte-check` fails on the
`newGame` call above. In `frontend/src/lib/aiClient.ts`, replace the `newGame`
method:

```ts
  newGame(o: {
    modelUrl: string; ortBase: string; boardSize: number; maxWalls: number;
    maxSteps: number; humanPlayer: number; params: Params;
  }) {
    // `params` may be a Svelte $state proxy, which postMessage can't structure-
    // clone (DataCloneError). Spread into a plain object first.
    this.worker.postMessage({ type: "newGame", ...o, params: { ...o.params } });
  }
```

Everything else in the file is unchanged. The worker on the other end of that
`postMessage` still reads `m.model` and ignores `m.ortBase`; Task 5 fixes that.
The app therefore builds and type-checks after this task but cannot load a
model until Task 5 lands.

- [ ] **Step 5: Delete the fetch-based API client**

Its last two importers are gone as of this task, so it goes now:

```bash
git rm frontend/src/lib/api.ts frontend/src/lib/api.test.ts
```

Run: `grep -rn "lib/api\|ConfigView\|ModelsView" frontend/src`
Expected: no output.

- [ ] **Step 6: Type-check and test**

Run:
```bash
npm --prefix frontend exec svelte-check -- --threshold error
npm --prefix frontend run test
```
Expected: `svelte-check` reports 0 errors; all vitest suites pass.

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src
git commit -m "vibe: start the game without waiting on a server

With the catalogue known at build time there is nothing to fetch, so the
loading state, the onMount round-trip and the failed-to-load error path
all disappear.

The model picker now drives board dimensions, which is what lets a 5x5
and a 9x9 model coexist. That means switching models has to start a new
game: the running position may not even be legal on the new board.

Splitting the drawer's callback in two is what makes that possible --
the parent could not previously tell a model switch from a slider drag."
```

---

### Task 5: Rewire the worker

**Files:**
- Modify: `frontend/src/ai.worker.ts`

**Interfaces:**
- Consumes: the `newGame` message shape from Task 4 — `{ type: "newGame", modelUrl, ortBase, boardSize, maxWalls, maxSteps, humanPlayer, params }`.
- Produces: an end-to-end working app. This is the last code task before the app can be played.

- [ ] **Step 1: Update `ai.worker.ts`**

In `frontend/src/ai.worker.ts`, delete these two lines near the top:

```ts
// Serve ORT's wasm/mjs from our own origin (copied there by vite-plugin-static-copy).
ort.env.wasm.wasmPaths = "/ort/";
```

Replace the `loadSession` function with:

```ts
async function loadSession(modelUrl: string, ortBase: string) {
  // Both URLs are resolved by the main thread against the site's base (see
  // siteBase() in lib/models.ts), so the worker never does path arithmetic --
  // it has no reliable view of where the site is mounted.
  ort.env.wasm.wasmPaths = ortBase;
  // Release the old session first so repeated New Game / model switches don't
  // leak GPU/WASM memory (ORT has no FinalizationRegistry backstop).
  if (session) { await session.release(); session = null; }
  session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ["webgpu", "wasm"],
  });
  console.log("[ai] session ready:", session.inputNames, "->", session.outputNames);
}
```

In the `newGame` branch of `self.onmessage`, replace the log and load lines:

```ts
      console.log("[ai] newGame model=", m.modelUrl);
      await ensureWasm();
      params = m.params;
      await loadSession(m.modelUrl, m.ortBase);
```

Everything else in the file is unchanged.

- [ ] **Step 2: Verify no hardcoded paths remain**

Run: `grep -rn '"/ort/\|"/models/\|`/models/' frontend/src`
Expected: no output.

- [ ] **Step 3: Build and run the gate**

Run:
```bash
wasm-pack build rust/quoridor-wasm --target web --release
npm --prefix frontend install
npm --prefix frontend run build
rm -rf /tmp/pages && mkdir -p /tmp/pages/lll_alpha_quoridor
cp -r frontend/dist/. /tmp/pages/lll_alpha_quoridor/
python3 -m http.server 8080 -d /tmp/pages
```

Open `http://localhost:8080/lll_alpha_quoridor/`.

The subpath is the point: root-absolute URL bugs pass at the root and only
404 under a prefix, which is exactly how a GitHub project page is served.
`http.server` has no routing, no API and no custom headers, so if the app
works there, the app is genuinely static.

Verify, with DevTools open:
- The board renders and the model picker shows "5×5, 2 walls (mv1)".
- A full game can be played to a win.
- Network tab: no 404s, and no request to any `/api/*` path.
- Network tab: `model.onnx` is fetched from
  `/lll_alpha_quoridor/models/b5w2-mv1/model.onnx`.
- Console: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/ai.worker.ts
git commit -m "vibe: hand the worker resolved URLs

The worker had /ort/ and /models/ baked in, which are exactly the paths
that 404 under a GitHub project page's /<repo>/ prefix.

A worker has no reliable view of where the site is mounted, so the main
thread resolves both URLs against the site base and passes them in. Path
resolution now happens in one tested place instead of two untested ones."
```

---

### Task 6: Delete the play server

**Files:**
- Delete: `src/run_play_server_web.py`, `src/v2/play_server_web/`, `test/test_play_server_web.py`
- Modify: `requirements.txt`, `ci_requirements.txt`

**Interfaces:**
- Consumes: nothing. Depends only on Task 5 having proven the app works without the server.
- Produces: a repo where the Python side is the trainer only.

- [ ] **Step 1: Confirm the dependencies are exclusive to the server**

Run:
```bash
source .venv/bin/activate
grep -rn "import httpx\|import uvicorn\|from fastapi\|import fastapi\|TestClient" --include="*.py" src test scripts
```
Expected: matches only in `src/run_play_server_web.py`,
`src/v2/play_server_web/app.py` and `test/test_play_server_web.py`. `httpx`
appears nowhere directly — it is present only as `TestClient`'s transport.

- [ ] **Step 2: Delete the server**

```bash
git rm -r src/v2/play_server_web src/run_play_server_web.py test/test_play_server_web.py
```

- [ ] **Step 3: Drop the dependencies**

Remove the lines `fastapi`, `uvicorn` and `httpx` from both
`requirements.txt` and `ci_requirements.txt`.

- [ ] **Step 4: Verify the Python suite is still green**

Run:
```bash
source .venv/bin/activate
PYTHONPATH=src pytest test
```
Expected: PASS, with the play-server tests no longer collected.

Run: `grep -rn "play_server_web\|run_play_server" --include="*.py" src test scripts`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add -A src test requirements.txt ci_requirements.txt
git commit -m "vibe: delete the play server

Its four jobs -- two JSON endpoints, the model files and the COOP/COEP
headers -- now have static answers, and the AI always ran in the browser
anyway. Keeping it would mean maintaining a second, divergent way to
play the same game.

It was also the only reason someone who just wanted to play needed a
Python environment.

The docs under docs/superpowers/ that describe it stay: they are the
record of how it was built, not instructions for running it."
```

---

### Task 7: Build guard and documentation

**Files:**
- Create: `frontend/scripts/check-build.mjs`
- Modify: `frontend/package.json`, `README.md`, `frontend/README.md`

**Interfaces:**
- Consumes: the `dist/` layout from Task 3.
- Produces: `npm --prefix frontend run check:build`, which PR 3 wires into CI.

- [ ] **Step 1: Write the check script**

Create `frontend/scripts/check-build.mjs`:

```js
/**
 * Post-build assertions for the static site. Guards the two regressions that
 * pass every local check and only fail once deployed under a path prefix:
 * root-absolute asset URLs, and copy targets that silently stop matching.
 *
 * Run: npm --prefix frontend run check:build   (after npm run build)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;
const src = new URL("../src/", import.meta.url).pathname;
const failures = [];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// 1. index.html must not reference assets from the site root.
const html = readFileSync(join(dist, "index.html"), "utf8");
for (const m of html.matchAll(/(src|href)="\/[^/]/g)) {
  failures.push(`dist/index.html has a root-absolute ${m[1]}: ${m[0]}`);
}

// 2. At least one model must have been copied, with its .onnx.
const distFiles = walk(dist);
const onnx = distFiles.filter((p) => /\/models\/[^/]+\/model\.onnx$/.test(p));
if (onnx.length === 0) {
  failures.push("no dist/models/<id>/model.onnx -- the models copy target stopped matching");
}

// 3. ORT's runtime must have been copied.
if (!distFiles.some((p) => /\/ort\/.*\.wasm$/.test(p))) {
  failures.push("no dist/ort/*.wasm -- the onnxruntime-web copy target stopped matching");
}

// 4. Our own source must not hardcode site-root paths. This reads src/ rather
//    than the bundle on purpose: the worker chunk has all of ORT inlined into
//    it, so scanning built output for these strings risks false positives on
//    ORT's own code.
for (const p of walk(src)) {
  const text = readFileSync(p, "utf8");
  for (const lit of ['"/ort/', '"/models/', "`/models/", "`/ort/"]) {
    if (text.includes(lit)) {
      failures.push(`${p.slice(src.length)} hardcodes ${lit} -- use siteBase() from lib/models.ts`);
    }
  }
}

if (failures.length) {
  console.error("check:build FAILED\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log(`check:build OK (${onnx.length} model(s) bundled)`);
```

- [ ] **Step 2: Add the npm script**

In `frontend/package.json`, add to `"scripts"`:

```json
    "check:build": "node scripts/check-build.mjs",
```

- [ ] **Step 3: Verify it passes on the current build**

Run:
```bash
npm --prefix frontend run build
npm --prefix frontend run check:build
```
Expected: `check:build OK (1 model(s) bundled)`.

- [ ] **Step 4: Verify it actually catches a regression**

Run:
```bash
mv frontend/dist/ort /tmp/ort-stash
npm --prefix frontend run check:build; echo "exit=$?"
mv /tmp/ort-stash frontend/dist/ort
```
Expected: FAILS with the `no dist/ort/*.wasm` message and `exit=1`. A guard
that has never failed is not known to work.

- [ ] **Step 5: Update `frontend/README.md`**

Replace the "Run (play a game)" section and the play-server references. The
build section becomes:

````markdown
## Build

```
# 1. Build the wasm package:
wasm-pack build rust/quoridor-wasm --target web --release
# 2. Build the frontend:
npm --prefix frontend install
npm --prefix frontend run build       # -> frontend/dist/
npm --prefix frontend run check:build # post-build assertions
```

## Run (play a game)

`frontend/dist/` is a self-contained static site — any file server will do,
and no Python is involved.

```
npm --prefix frontend run preview
```

To reproduce how GitHub Pages actually serves it, put the build under a path
prefix. This is the check that matters: root-absolute URL bugs pass at the
root and only 404 under a prefix.

```
rm -rf /tmp/pages && mkdir -p /tmp/pages/lll_alpha_quoridor
cp -r frontend/dist/. /tmp/pages/lll_alpha_quoridor/
python3 -m http.server 8080 -d /tmp/pages
# open http://localhost:8080/lll_alpha_quoridor/
```

Dev mode with HMR: `npm --prefix frontend run dev`. Everything the app needs
is static, so dev is fully functional.

## Models

Each model is a directory under `frontend/models/`:

```
frontend/models/b5w2-mv1/
  model.onnx
  meta.json     # label, default flag, board_size, max_walls, max_steps, defaults{}
```

The list is globbed at build time, so adding a model is "drop in a directory
and rebuild" — there is no index to keep in sync. Selecting a model with a
different board size starts a new game on that board.
````

Also update the "How it fits together" diagram's last line, replacing the
`Python server: ...` line with:

```
Static files:  index.html · assets/* · models/<id>/model.onnx · ort/*.wasm
```

And in the intro paragraph, replace "Served by the Python play server
(`src/run_play_server_web.py`)." with "Builds to a self-contained static
site."

- [ ] **Step 6: Update the root `README.md`**

In the "Quickstart" section, replace the play-directory setup and the
`Start the play server` block (everything from `Set up a play directory:`
through the `Open http://localhost:8080 ...` paragraph) with:

````markdown
Then serve the build. It is a self-contained static site — any file server
works, and the model is bundled into it:

```bash
npm --prefix frontend run preview
```

Open the URL it prints and play.
````

Remove the `pip install -r requirements.txt` step's role in playing if it is
described as required for the browser game — the venv is now only needed for
training and tests. In the "Repo layout" table, change the `src/` row's
contents from `game env, agents, v2/ training pipeline, play server` to
`game env, agents, v2/ training pipeline`, and the `frontend/` row to
`Static Svelte site that plays a trained model client-side via onnxruntime-web`.

- [ ] **Step 7: Verify the documented commands actually work**

Run the exact commands from the updated `frontend/README.md` build section,
then the subpath recipe. Expected: the site loads and a game is playable at
`http://localhost:8080/lll_alpha_quoridor/`.

- [ ] **Step 8: Commit**

```bash
git add frontend/scripts/check-build.mjs frontend/package.json README.md frontend/README.md
git commit -m "vibe: guard the build against path regressions

Absolute asset URLs and a copy target that stops matching both build
cleanly and only fail once deployed under a path prefix, where nobody is
watching. Asserting on the build output turns both into a failed command.

The source scan reads src/ rather than the bundle because the worker
chunk has all of onnxruntime inlined into it, and its own code would
trip a naive string search."
```

---

### Task 8: Formatting and final verification

**Files:** whatever the formatters touch.

**Interfaces:**
- Consumes: everything above.
- Produces: the branch ready for a PR.

- [ ] **Step 1: Run the Python linter over what this branch touched**

The repo has `ruff.toml`. Scope it to the Python files this branch actually
changed — running it over all of `src test` reformats ~76 files of
pre-existing drift, which would bury this PR's diff and violates the
"keep each PR small and scoped to one change" rule in AGENTS.md.

```bash
source .venv/bin/activate
CHANGED=$(git diff --name-only main...HEAD -- '*.py')
if [ -n "$CHANGED" ]; then
  ruff format $CHANGED
  ruff check $CHANGED --fix
else
  echo "no Python files changed on this branch; nothing to format"
fi
```

This branch only *deletes* Python files, so the expected result is the
`else` branch and no formatting commit. Project-wide reformatting is its
own PR, if anyone wants it.

- [ ] **Step 2: Run the full verification sweep**

```bash
source .venv/bin/activate
# test/os_pz_conversion_test.py fails to import on `main` too: the venv's
# open_spiel no longer exposes algorithms.alpha_zero.model, which
# src/agents/alphazero_os.py imports. Pre-existing and unrelated to this
# branch, so exclude it to get real signal. Do not "fix" it here.
PYTHONPATH=src pytest test --ignore=test/os_pz_conversion_test.py
npm --prefix frontend run test
npm --prefix frontend exec svelte-check -- --threshold error
npm --prefix frontend run build
npm --prefix frontend run check:build
```
Expected: all pass. Record the actual output — do not claim success without
reading it.

- [ ] **Step 3: Confirm nothing references the removed server**

```bash
grep -rn "api/config\|api/models\|play_server_web\|run_play_server" \
  --include="*.py" --include="*.ts" --include="*.svelte" --include="*.md" \
  src test frontend/src README.md frontend/README.md
```
Expected: no output. (Matches under `docs/superpowers/` are expected and
correct — that is the historical record.)

- [ ] **Step 4: Commit formatting separately, if anything changed**

Per AGENTS.md, formatting and lint changes go in their own commit so
reviewers can read the functional diff first.

```bash
git status --short
# only if there are changes:
git add -A
git commit -m "vibe: apply formatter output"
```

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin vibe/static-frontend
```

Write the results file first (see below), then:

```bash
gh pr create --base main --title "vibe: serve the frontend as a static site" \
  --body-file docs/superpowers/results/2026-08-07-static-frontend-results.md
```

Report the PR URL. Do not merge.

- [ ] **Step 6: Write the results file**

Create `docs/superpowers/results/2026-08-07-static-frontend-results.md`
covering: what changed and why, the before/after of how the app is served,
the `.gitignore` finding, the behaviour change where switching models
changes the board, the single-threaded wasm-CPU consequence of dropping
COOP/COEP, verification output from Step 2, and what the remaining four PRs
will cover.

---

## Self-Review

**Spec coverage.** Every PR 1 requirement in the spec maps to a task: model
bundle and schema → Task 1; glob and `models.ts` → Task 2; static copy and
`base: "./"` → Task 3; `App.svelte`/`ConfigDrawer` and the board-switching
behaviour → Task 4; worker URL handling → Task 5; deletions and dependency
removal → Task 6; `check:build`, README rewrites → Task 7; the subpath gate
→ Task 5 Step 4 and Task 7 Step 7. The `.gitignore` fix the spec gained
during planning → Task 1. PRs 2–5 are deliberately out of scope for this
plan.

**Placeholder scan.** No TBD/TODO; every code step carries real code. Task 7
Step 6's README edit is described by replaced-region rather than full text,
because it is prose surgery on a file the implementer can read — the exact
replacement text is given.

**Type consistency.** `ModelEntry` fields are `snake_case` for the four
config values (`board_size`, `max_walls`, `max_steps`, `defaults`) and
`camelCase` for the two derived ones (`id`, `isDefault`), used consistently
in Tasks 2, 4 and 7. `params` keeps its existing `camelCase` shape
(`mctsN`, `cPuct`, `leafParallelism`, `virtualLoss`) across `App.svelte`,
`ConfigDrawer` and `aiClient`. `newGame`'s object shape matches exactly
between Task 4 Step 1 (caller) and Task 5 Step 1 (callee):
`modelUrl`, `ortBase`, `boardSize`, `maxWalls`, `maxSteps`, `humanPlayer`,
`params`.

**Every task leaves a green build.** `api.ts` is deleted in Task 4 alongside
its last two importers rather than in Task 2 where it is superseded, which
costs one commit of dead-but-harmless code and buys a branch where no commit
is broken. Tasks 3 and 4 are the only pair with a visible gap — after Task 3
the build output is correct but the app still calls `/api/config`, so it
builds and does not run. Task 4 closes that.
