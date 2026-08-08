# Serve the frontend as a static site

Converts the Quoridor play app into a purely static site and deletes the
Python play server. This is PR 1 of five; the rest are listed at the bottom.

Design: `docs/superpowers/specs/2026-08-07-static-frontend-github-pages-design.md`
Plan: `docs/superpowers/plans/2026-08-07-static-frontend.md`

## Why

The AI already ran entirely in the browser — `quoridor-wasm` does the MCTS and
`onnxruntime-web` evaluates the network. The FastAPI server did no inference.
It supplied four things, and each has a static answer:

| Server did | Static replacement |
|---|---|
| `GET /api/config` — board dims + MCTS defaults from `config.yaml` | `meta.json` inside each model's directory |
| `GET /api/models` — the list and its default | `import.meta.glob` over those `meta.json` files at build time |
| `GET /models/*.onnx` | `.onnx` copied into `dist/models/` by `vite-plugin-static-copy` |
| COOP/COEP headers | dropped — GitHub Pages cannot set response headers |

So the server was the only reason someone who just wanted to play needed a
Python environment, and the only thing standing between this app and any
static host.

## What changed

**Models are now data on disk.** One directory per model:

```
frontend/models/b5w2-mv1/
  model.onnx
  meta.json     # label, default flag, board_size, max_walls, max_steps, defaults{}
```

The list is globbed at build time, so it cannot drift from the files on disk
and adding a model is "drop in a directory and rebuild" — no index to
maintain. PR 5 documents that walkthrough.

**`frontend/src/lib/models.ts`** replaces the fetch-based `api.ts`: types,
validation, the glob, default selection, and URL resolution. Its pure
functions take everything as arguments, so they test under vitest's `node`
environment without DOM stubbing; only three thin wrappers touch browser
globals.

**All URL resolution happens once, on the main thread.** `vite.config.ts` sets
`base: "./"`, and `siteBase()` resolves against `location`. The worker lost
both its hardcoded `"/ort/"` and `` `/models/${model}` `` literals and now
receives fully-resolved absolute URLs by message — a worker has no reliable
view of where the site is mounted.

**The server is gone**, along with `fastapi`, `uvicorn` and `httpx` (verified
exclusive to it; `httpx` was only `TestClient`'s transport). The
`docs/superpowers/` files describing it stay — they are the record of how it
was built, not instructions for running it.

## Behaviour changes

**Switching models now starts a new game on that model's board.** Previously a
single `config.yaml` governed every model, so the board never changed at
runtime and switching models silently did nothing until the next New Game.
Per-model metadata lets a 5×5 and a 9×9 model coexist, so the board has to
follow the selection.

**Cross-origin isolation is gone, in dev too.** GitHub Pages cannot set
headers, so it is unreachable in production; keeping it in dev would only hide
the difference until deploy day. The consequence is that onnxruntime's
wasm-CPU fallback now runs single-threaded. The WebGPU path — the primary one
— is unaffected. PR 2 makes WebGPU mandatory and removes the fallback.

## A trap worth recording

The root `.gitignore` has a `models/` rule for training output. That pattern
matches a directory of that name **at any depth**, so it silently swallowed
`frontend/models/`: `git add` would report nothing, the build would work
locally off the untracked files, and the deploy would ship an empty model
picker with no error anywhere. A `!frontend/models/` negation fixes it,
verified to leave `runs/*/models/` and a top-level `models/` still ignored.

## Verification

The gate that matters is **serving the build from a subdirectory**, because
root-absolute URL bugs pass at the root and only 404 under a prefix — which is
exactly how a GitHub project page is served:

```bash
npm --prefix frontend run build
rm -rf /tmp/pages && mkdir -p /tmp/pages/lll_alpha_quoridor
cp -r frontend/dist/. /tmp/pages/lll_alpha_quoridor/
python3 -m http.server 8080 -d /tmp/pages
# http://localhost:8080/lll_alpha_quoridor/
```

`http.server` has no routing, no API and no custom headers, so if the app works
there, the site is genuinely static. Every asset resolved under the prefix and
`/api/config` returned 404.

`npm --prefix frontend run check:build` guards the two regressions that build
cleanly and only fail once deployed: root-absolute asset URLs, and a copy
target that silently stops matching. It also pairs every `meta.json` with its
`model.onnx`, so a **misnamed** model file fails the build naming the
directory rather than 404ing in production. The guard was verified by watching
it fail, not only by watching it pass.

Current state:

```
pytest                            89 passed
vitest                            23 passed
svelte-check --threshold error     0 errors
build                             succeeded
check:build                       OK (1 model bundled)
```

Two caveats stated plainly:

- `test/os_pz_conversion_test.py` is excluded from that pytest run. It fails to
  import on `main` identically — the venv's `open_spiel` no longer exposes
  `algorithms.alpha_zero.model`. Pre-existing and unrelated to this branch.
- **Nobody has played a game in a real browser yet.** `curl` proved the files
  are reachable under the prefix; it did not prove that ORT resolves
  `wasmPaths` at runtime and completes inference now that cross-origin
  isolation is gone. That is the one first-run-only failure mode left, and it
  is worth exercising before merge.

## Known, deferred deliberately

- **`dist/` is 117 MB**, ~114 MB of it onnxruntime variants the app never
  loads, plus a duplicate Vite emits separately. The copy globs predate this
  PR, but this PR is what turns them into a deploy payload. PR 2 is the
  natural place to narrow them — once WebGPU is required, far fewer ORT builds
  are needed.
- **`.mjs` MIME type.** Setting `ort.env.wasm.wasmPaths` makes production
  depend on the host serving `.mjs` as JavaScript. Python's `http.server`
  always does, so the local gate is blind to this; it belongs on PR 4's
  live-site checklist.
- Smaller items — `parseMeta` accepting an array, `isDefault` coercing
  silently, `check-build.mjs`'s error output before a build — are recorded in
  the branch's review ledger and were triaged as fix-later.

## The remaining PRs

2. **WebGPU required** — detect it up front and refuse cleanly instead of
   falling back to a single-threaded wasm-CPU search.
3. **Frontend CI** — `wasm-pack build` + `npm test` + `npm run build` +
   `check:build` on PRs, so a green PR means a deployable build.
4. **GitHub Pages** — enable Pages and add the deploy workflow.
5. **`CONTRIBUTING.md` + a better model** — the add-a-model walkthrough, with a
   real second model as the worked example.
