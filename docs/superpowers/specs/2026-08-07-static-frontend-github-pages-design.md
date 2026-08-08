# Static frontend on GitHub Pages

Serve the Quoridor play app as a purely static site, hosted on GitHub Pages,
and delete the Python play server.

## Motivation

The AI already runs entirely in the browser: `quoridor-wasm` does the MCTS and
`onnxruntime-web` evaluates the network. The FastAPI server
(`src/v2/play_server_web/`) does no inference. It supplies four things, and
each has a static answer:

| Server does today | Static replacement |
|---|---|
| `GET /api/config` — board dims + MCTS defaults from `config.yaml` | `meta.json` in each model's directory |
| `GET /api/models` — the list and its default | `import.meta.glob` over those `meta.json` files at build time |
| `GET /models/*.onnx` | `.onnx` copied into `dist/models/` by `vite-plugin-static-copy` |
| COOP/COEP headers | Dropped; WebGPU becomes a requirement |

Removing the server removes the only reason a player needs a Python
environment, and makes the app deployable to any static host.

## Delivery

Five pull requests, each with its own verification gate:

1. **Statification** — model directories, glob-based manifest, relative base
   paths, server deleted.
2. **WebGPU required** — detect it up front and refuse cleanly instead of
   falling back to wasm-CPU.
3. **Frontend CI** — `wasm-pack build` + `npm test` + `npm run build` on PRs.
4. **GitHub Pages** — enable Pages, add the deploy workflow.
5. **Add-a-model docs** — `CONTRIBUTING.md`, with a better model as the
   worked example.

## PR 1 — Statification

### Model bundle

One directory per model, checked into git:

```
frontend/models/
  b5w2-mv1/
    model.onnx
    meta.json
```

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

The directory name is the model id. `default: true` marks the default; if no
entry or more than one carries it, the loader falls back to the last id in
sort order, preserving the current "highest version wins" behaviour.

This schema is deliberately narrower than today's `/api/config`.
`temperature`, `mcts_noise_epsilon`, `mcts_noise_alpha` and
`mcts_worker_threads` are served today and read by nothing — they are
self-play training knobs with no meaning at inference time.

PR 1 bundles a copy of `rust/fixtures/alphazero_B5W2_mv1.onnx` as
`b5w2-mv1`. The fixture stays where it is: it is a Rust test fixture with a
different lifecycle, and coupling the frontend build to it would break the
build if it were ever moved.

### Build wiring

Metadata is discovered at compile time:

```ts
// frontend/src/lib/models.ts
const metas = import.meta.glob("../../models/*/meta.json", { eager: true });
```

Vite parses JSON natively, so this needs no plugin. Because the list comes
from the filesystem, it cannot drift from the files on disk, and adding a
model is "drop in a directory and rebuild" — which is what keeps PR 5's
contributor doc short.

The `.onnx` files are copied verbatim by the `vite-plugin-static-copy` that
already copies ORT's runtime:

```ts
viteStaticCopy({
  targets: [
    { src: "node_modules/onnxruntime-web/dist/*.wasm", dest: "ort" },
    { src: "node_modules/onnxruntime-web/dist/*.mjs",  dest: "ort" },
    { src: "models/*",                                  dest: "models" },
  ],
})
```

Copying whole directories means `meta.json` ships alongside its model. It is
never read at runtime — the glob is the only source of truth — but it makes
the deployed site self-describing.

The root `.gitignore` needs a one-line fix. Its `models/` rule (line 48,
for training output) matches a directory of that name at any depth, so it
silently swallows `frontend/models/` — `git add` would report nothing and
the site would deploy with an empty model list. A `!frontend/models/`
negation re-includes it, verified to leave `runs/*/models/` and a top-level
`models/` still ignored. This mirrors the `!frontend/src/lib/` negation the
same file already carries for the Python template's `lib/` rule.

The alternative considered was emitting each `.onnx` through Vite as a
hashed asset (`import.meta.glob(..., { query: "?url" })`), which would give
base-relative URLs and cache-busting for free. It was rejected as a second
copy mechanism for a benefit that only matters when a model is *replaced in
place*, against GitHub Pages' short cache window. Adding a model as a new
directory — the common case — is unaffected.

### Base paths

`vite.config.ts` sets `base: "./"`. A GitHub project page is served from
`/lll_alpha_quoridor/`, so root-absolute URLs break; a relative base works at
the root, under a prefix, and under a future custom domain with no change.

Two URLs are built by hand — the model and ORT's runtime directory — so
resolution lives in exactly one unit-tested function on the main thread:

```ts
const resolve = (path: string) =>
  new URL(path, new URL(import.meta.env.BASE_URL, location.href)).href;
```

`ai.worker.ts` receives fully-resolved absolute URLs in its `newGame`
message and does no path math at all, losing both its hardcoded `"/ort/"`
and `` `/models/${model}` `` literals.

### Frontend changes

`lib/api.ts` and `api.test.ts` are replaced by `lib/models.ts` and
`models.test.ts`. `models.ts` exposes the loaded `ModelEntry[]`,
`pickDefault()`, `resolve()`, and a small validator that throws a legible
error on a malformed `meta.json` rather than rendering a blank page — which
matters when a contributor following PR 5's doc typos a field.

In `App.svelte`, models are available synchronously at module load, so the
`onMount` fetch, the `"Loading…"` state and the
`"Failed to load config/models"` path all disappear. Board dimensions become
`$derived` from the selected entry.

This changes one behaviour: **selecting a different model starts a new game
on that model's board.** Today a single `config.yaml` governs every model, so
the board never changes at runtime. Per-model metadata makes a 5×5 and a 9×9
model coexist, and the board must follow the selection. It is implemented
here rather than in a separate PR because it is the same code path — reading
dimensions from the selected entry instead of a global — and deferring it
would mean shipping `dims = firstModel.dims`, which is correct only by
accident of there being one model. It becomes observable in PR 5.

`ConfigDrawer.svelte` swaps `ConfigView`/`ModelsView` for `ModelEntry[]` and
shows `meta.label` instead of a raw `.onnx` filename.

`vite.config.ts` also **drops the COOP/COEP dev headers**. GitHub Pages
cannot set response headers, so cross-origin isolation is unreachable in
production; keeping it in dev would make dev diverge from prod. In PR 1 this
means the wasm-CPU fallback runs single-threaded locally, which is the
honest preview of what Pages would give. PR 2 removes that path entirely.

### Deletions

```
src/run_play_server_web.py
src/v2/play_server_web/     (app.py, config_view.py, model_listing.py, README.md, __init__.py)
test/test_play_server_web.py
fastapi, uvicorn, httpx     from requirements.txt and ci_requirements.txt
```

All three dependencies were verified to be exclusive to the play server;
`httpx` is present only as `TestClient`'s transport.

`README.md` and `frontend/README.md` lose their run-the-server sections,
rewritten around `npm run build` plus any static server. The files under
`docs/superpowers/specs/` and `docs/superpowers/plans/` that describe the old
server stay untouched — they are the historical record of how it was built,
not live documentation.

### Gate

Build, then serve `dist/` **from a subdirectory** with a deliberately dumb
server:

```bash
wasm-pack build rust/quoridor-wasm --target web --release
npm --prefix frontend install && npm --prefix frontend run build

rm -rf /tmp/pages && mkdir -p /tmp/pages/lll_alpha_quoridor
cp -r frontend/dist/. /tmp/pages/lll_alpha_quoridor/
python3 -m http.server 8080 -d /tmp/pages
# open http://localhost:8080/lll_alpha_quoridor/
```

The subpath mimics `adamantivm.github.io/lll_alpha_quoridor/`. Root-absolute
path bugs pass at the root and 404 under a prefix, so serving at the root
would give false confidence and PR 4 would fail publicly. `http.server` has
no routing, no API and no custom headers, so if the app works there,
statification is real by construction. It serves `.wasm` as
`application/wasm` (verified on Python 3.12), which streaming compilation
needs; `.onnx` arrives as `application/octet-stream`, which ORT does not care
about since it reads an ArrayBuffer.

Manual checks at that URL: board renders, picker populated, a full game plays
to a win, and DevTools Network shows no 404s and no `/api/*` request at all.

Automated:

- `npm --prefix frontend run test` — loading, default selection, validation
  errors, URL resolution under a subpath.
- `npm --prefix frontend run check:build` — a script asserting
  `dist/models/<id>/model.onnx` and `dist/ort/*.wasm` exist, that
  `dist/index.html` has no root-absolute `src=`/`href=`, and that no file
  under `frontend/src/` contains a `"/models/` or `"/ort/` literal. The last
  check reads our own source rather than the bundle: the worker chunk has
  all of ORT inlined into it, so scanning the built output for those strings
  would risk false positives on ORT's own code. This is the regression guard
  for the base-path bug; PR 3 wires it into CI.
- `PYTHONPATH=src pytest test` green after the server tests are deleted.

## PR 2 — Warn when WebGPU is unavailable

> **Revised.** This section originally made WebGPU mandatory: no adapter, no
> app. That was wrong, and testing disproved it — broken WebGPU turns out to
> be common enough that the repo owner's own Chrome, on a machine with a
> working GPU, cannot run it. A requirement that locks the maintainer out of
> their own project is not a requirement, it is a bug. The original text is
> preserved in git history.

A `lib/webgpu.ts` check that goes further than `navigator.gpu` being present:
it `await`s `requestAdapter()` and treats a null adapter as unsupported,
since the API can exist while the GPU is blocklisted or unavailable in a
headless or VM context. The check is bounded by a timeout, because
`requestAdapter()` can hang on a wedged GPU process.

**The check gates nothing.** The worker keeps
`executionProviders: ["webgpu", "wasm"]`, so onnxruntime falls back on its
own without being asked. The check's only job is to decide whether to show a
persistent banner above the app saying WebGPU is unavailable and the AI will
think more slowly until it is fixed. The app starts immediately either way,
which preserves PR 1's property of having no startup loading state.

This decoupling is what keeps the design small: no startup gate, no
"checking…" state, no lazily-constructed worker, and no path where a
detection bug can stop someone playing.

`dist/ort/` shrinks anyway, for an unrelated reason. The worker imports
`onnxruntime-web/webgpu`, which requests
`ort-wasm-simd-threaded.asyncify.{wasm,mjs}` beneath `wasmPaths` — and which
files it requests is decided by the entry point, **not** by the
`executionProviders` list. So shipping only those two is correct whether or
not the wasm fallback is enabled. Verified empirically by building both ways
and diffing the filename literals in the emitted worker chunk.

**Deliberately not done: restoring cross-origin isolation.** Without
COOP/COEP there is no `SharedArrayBuffer`, so the fallback runs
single-threaded. `coi-serviceworker` can forge those headers on a static
host and bring back multi-threading. It is deferred until there is a real
measurement showing the single-threaded search is too slow, rather than
built on the assumption that it is. Recorded in `frontend/README.md` as a
future improvement.

**Gate:** unit test the check against a stubbed `navigator.gpu`; confirm in
a browser without working WebGPU that the banner appears *and the game is
still playable*.

## PR 3 — Frontend CI

`.github/workflows/frontend-ci.yml`, on `pull_request` and `push` touching
`frontend/**`, `rust/src/**`, `rust/quoridor-wasm/**`, `rust/Cargo.*`, or the
workflow itself. Steps: Rust toolchain, `wasm-pack`, cargo cache,
`wasm-pack build rust/quoridor-wasm --target web --release`, Node with npm
cache, `npm install`, `npm test`, `npm run build`, `npm run check:build`.

`npm install`, not `npm ci`: the lockfile resolves `quoridor-wasm` by
relative path against the `pkg/` directory `wasm-pack` produces, so
`wasm-pack` must run first. This is already documented in the README.

The shared build steps go in a `.github/actions/build-frontend` composite
action, consumed by PR 4's deploy. The point of this PR is that a green PR
means a deployable build; two hand-maintained copies of the build steps can
drift silently and quietly kill that guarantee.

**Gate:** the workflow passes on its own PR.

## PR 4 — GitHub Pages

`.github/workflows/pages.yml` reuses the composite action, then
`actions/upload-pages-artifact` and `actions/deploy-pages`, with `pages:
write` and `id-token: write` permissions and a concurrency group so
overlapping merges do not race. Triggers on push to `main` filtered to the
same paths as PR 3, plus `workflow_dispatch` for manual redeploys.

No `.nojekyll` is needed; the Actions deploy path does not run Jekyll.

**Requires a manual step:** repo Settings → Pages → Source → *GitHub
Actions*. This cannot be done from the workflow.

**Gate:** the live site at `https://adamantivm.github.io/lll_alpha_quoridor/`,
checked on desktop and phone — the URL shape PR 1's subpath gate already
proved.

## PR 5 — Adding a model

`CONTRIBUTING.md` gains an "Adding a play model" walkthrough: export ONNX
from a training run (`training.save_onnx`, see `MODEL_SAVE_OPTIONS.md`),
create the directory, fill `meta.json` from a field table, move
`"default": true`, rebuild, verify with the local subpath recipe, open the
PR.

A better model ships as the worked example and becomes the default, making
the board-size switching from PR 1 observable for the first time.

Needed to start: the `.onnx` file, its `board_size` / `max_walls` /
`max_steps`, the `mcts_n` and `mcts_c_puct` defaults, and a display label.

**Gate:** follow the written doc literally from a clean checkout to add the
model. A wrong doc fails the gate.

## Out of scope

- **`coi-serviceworker`.** A service worker can forge COOP/COEP on a static
  host and restore multi-threaded wasm. Not needed while WebGPU is required,
  and it adds a stale-asset failure mode on redeploy.
- **Custom domain.** The relative base means adding one later changes
  nothing.
- **Migrating existing `runs/` directories.** The old play server read a run
  directory directly; the static site reads only what is committed under
  `frontend/models/`. Publishing a trained model is now an explicit,
  reviewable act, which is the intent.
