# Quoridor frontend (Svelte + Web Worker + onnxruntime-web)

The browser play app. A Web Worker runs the `quoridor-wasm` MCTS and evaluates the
net with onnxruntime-web (WebGPU when available, wasm CPU otherwise); the main
thread renders the board and streams the AI's "thinking" progress. Builds to a
self-contained static site. Design: `docs/superpowers/specs/2026-07-05-browser-wasm-play-server-design.md`.

## Build

```
# 1. Build the wasm package:
wasm-pack build rust/quoridor-wasm --target web --release
# 2. Build the frontend:
npm --prefix frontend install
npm --prefix frontend run build       # -> frontend/dist/
npm --prefix frontend run check:build # post-build assertions
```

## Browser requirements

WebGPU is used when available and is much faster. When it isn't, the app
falls back to onnxruntime's wasm CPU backend and shows a banner explaining
that the AI will think more slowly — it stays playable either way. Lowering
*MCTS sims* on the setup screen trades strength for speed on the CPU path.

The host must serve `dist/ort/*.mjs` with a JavaScript MIME type: onnxruntime
loads it with a dynamic `import()`, so a wrong content type fails as a
module-type error rather than a 404.

### `dist/` is 48 MB, but the app only fetches about half of that

`dist/ort/` (what the app actually requests) is ~24.3 MB and
`frontend/models/` is 416 KB. The remaining ~24 MB is
`dist/assets/ort-wasm-simd-threaded.asyncify-<hash>.wasm` — a second copy of
the same wasm binary that Vite emits on its own, because onnxruntime's
bundle contains a statically-analyzable `new URL(...)` reference to it.
Nothing fetches that hashed copy at runtime: `ai.worker.ts` sets
`ort.env.wasm.wasmPaths` before creating a session, which points ORT at
`dist/ort/` instead, and the code path that would use the hashed asset
(`env.wasm.proxy`, which defaults to `false`) isn't taken either. It is kept
for now rather than deleted — removing an emitted asset on static analysis
alone, before this branch has been run in a real browser, is how a previous
draft shipped a build that 404'd in production. Trimming it is a follow-up,
to attempt once the wasm-CPU fallback has been confirmed working end to end
in an actual browser.

### Possible future improvement: multi-threaded CPU fallback

The CPU fallback currently runs single-threaded, because onnxruntime needs
`SharedArrayBuffer` to use threads and that requires cross-origin isolation
(COOP/COEP headers), which GitHub Pages cannot send. A service worker such as
[`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker) can
supply those headers on a static host and restore multi-threading, at the
cost of an extra service worker and a first-load reload. Deferred until
there is a measurement showing the single-threaded search is actually too
slow.

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

## Deployment

`main` deploys automatically to
<https://adamantivm.github.io/lll_alpha_quoridor/> whenever a change lands
under `frontend/` or the Rust crates the wasm package is built from. The
workflow runs the same checks as CI before uploading, so a failed deploy
leaves the previous version serving rather than publishing a broken site.

### Verifying a deployment

Beyond loading the page and playing a move, one thing is worth checking on
the live site specifically, because no local check can catch it:

```bash
curl -sI https://adamantivm.github.io/lll_alpha_quoridor/ort/ort-wasm-simd-threaded.asyncify.mjs \
  | grep -i content-type
```

It must be a JavaScript type. onnxruntime loads that file with a dynamic
`import()`, so a wrong content type fails as a module-type error rather than
a 404 — and the local `python3 -m http.server` recipe always serves `.mjs`
correctly, which makes it blind to this.

The other thing worth checking is that the no-slash URL redirects:

```bash
curl -sI https://adamantivm.github.io/lll_alpha_quoridor | grep -iE "^HTTP|^location"
```

It must 301 to the trailing-slash URL. The build uses Vite's `base: "./"`,
so every asset URL is resolved relative to the *document* URL — that only
works if the document URL ends in `/`. GitHub Pages redirects the no-slash
path, but nothing local exercises that redirect (`python3 -m http.server`
redirects too), so this is blind in exactly the way the `.mjs` content-type
check is.

## Models

Each model is a directory under `frontend/models/`:

```
frontend/models/b5w2-mv1/
  model.onnx
  meta.json     # label, default flag, board_size, max_walls, max_steps,
                # defaults{mcts_n, mcts_c_puct, leaf_parallelism, virtual_loss}
```

The list is globbed at build time, so adding a model is "drop in a directory
and rebuild" — there is no index to keep in sync. The model is picked on the
setup screen, and picking one also loads its tuned search defaults.

## How it fits together

```
Browser
  main thread (Svelte)  ── postMessage ─▶  Web Worker (ai.worker.ts)
    setup screen, board,  ◀─ state/progress ─   quoridor-wasm  (game + MCTS)
    progress bar, undo                           onnxruntime-web (WebGPU/wasm) ── eval_batch
Static files:  index.html · assets/* · models/<id>/model.onnx · ort/*.{wasm,mjs}
```

The setup screen (nickname, model, who plays first, search parameters) is what
you see before a game; pressing *Start game* is what sends `newGame` to the
worker. Everything it collects is fixed for the whole game — changing the
opponent's strength mid-game would make both the game and its recorded row
meaningless — so *New game* returns to that screen rather than restarting in
place.

## Tests
```
npm --prefix frontend run test   # vitest: board model, eval marshalling, model list
```
Unit tests cover the pure logic (board derivation, eval tensor marshalling, model
list loading). End-to-end gameplay (onnxruntime inference, progress bar, clicking) is
a manual browser check — actually playing needs a real browser.

These same checks — `svelte-check`, the unit tests, `npm run build` and
`npm run check:build` — run in CI on every pull request that touches
`frontend/` or the Rust crates the wasm package is built from, so a green PR
means the site can actually be built.
