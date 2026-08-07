# Quoridor frontend (Svelte + Web Worker + onnxruntime-web)

The browser play app. A Web Worker runs the `quoridor-wasm` MCTS and evaluates the
net with onnxruntime-web (WebGPU, wasm-CPU fallback); the main thread renders the
board and streams the AI's "thinking" progress. Builds to a self-contained static
site. Design: `docs/superpowers/specs/2026-07-05-browser-wasm-play-server-design.md`.

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

## How it fits together

```
Browser
  main thread (Svelte)  ── postMessage ─▶  Web Worker (ai.worker.ts)
    board, progress bar,  ◀─ state/progress ─   quoridor-wasm  (game + MCTS)
    undo, config drawer                          onnxruntime-web (WebGPU) ── eval_batch
Static files:  index.html · assets/* · models/<id>/model.onnx · ort/*.wasm
```

## Tests
```
npm --prefix frontend run test   # vitest: board model, eval marshalling, model list
```
Unit tests cover the pure logic (board derivation, eval tensor marshalling, model
list loading). End-to-end gameplay (WebGPU inference, progress bar, clicking) is a
manual browser check — actually playing needs a real browser.
