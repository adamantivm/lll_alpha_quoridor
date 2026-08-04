# Quoridor AlphaZero

An AlphaZero-style implementation of the board game Quoridor. A Python trainer
(PyTorch + a custom self-play/MCTS loop) produces ONNX models; a Rust engine
(`quoridor-rs`, with PyO3 bindings for training and a `wasm-pack` build for the
browser) implements the game rules and search; a Svelte frontend runs trained
models client-side (via `onnxruntime-web`) so a browser can play against a
model with no server-side inference at all.

## Prerequisites

- Python 3.12
- A Rust toolchain (via [rustup](https://rustup.rs/)) and `wasm-pack`
- Node.js
- `pkg-config` and `libssl-dev` (or your distro's equivalent) — needed to build
  the Rust `binary` feature, which pulls in `ort` -> `ureq` -> `native-tls` ->
  `openssl-sys`:

  ```bash
  sudo apt-get install -y pkg-config libssl-dev
  ```

## Quickstart: play against the bundled model

This plays a browser game against a small pre-trained model checked into the
repo (`rust/fixtures/alphazero_B5W2_mv1.onnx`, a 5x5 board with 2 walls per
player), with no training required.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Build the WASM package the frontend depends on, then the frontend itself
(`npm install`, not `npm ci` — the lockfile resolves `quoridor-wasm` by
relative path against the `pkg/` directory `wasm-pack` just produced, so
`wasm-pack` must run first):

```bash
wasm-pack build rust/quoridor-wasm --target web --release
npm --prefix frontend install
npm --prefix frontend run build
```

Set up a play directory: a `config.yaml` describing the board, and a
`models/` directory of `.onnx` files.

```bash
mkdir -p playdir/models
cp rust/fixtures/alphazero_B5W2_mv1.onnx playdir/models/model_1.onnx
cat > playdir/config.yaml <<'EOF'
run_id: play
quoridor:
  board_size: 5
  max_walls: 2
  max_steps: 50
alphazero:
  mcts_n: 200
  mcts_c_puct: 1.4
self_play:
  num_processes: 1
  games_per_process: 1
training:
  games_per_training_step: 1.0
  learning_rate: 0.001
  batch_size: 64
  weight_decay: 0.0001
  replay_buffer_size: 1000
EOF
```

Start the play server, which serves the built frontend plus the model and
config over a small FastAPI app:

```bash
PYTHONPATH=src python src/run_play_server_web.py playdir --static-dir frontend/dist --port 8080
```

Open `http://localhost:8080` in a browser and play. (`/api/config`,
`/api/models`, `/models/<name>.onnx`, and `/ort/<file>.wasm` are the
underlying routes, if you want to check the server directly with `curl`.)

## Running the tests

```bash
PYTHONPATH=src pytest test
```

```bash
cd rust
cargo fmt --all -- --check
cargo clippy --all-targets --all-features
cargo build
cargo build --release
cargo test --features binary
```

Run these with the Python virtualenv above activated: the `binary` feature's
tests shell out to `python3` for cross-language consistency checks (comparing
the Rust and Python implementations directly), and need it to resolve to the
project's Python with `numpy` and friends installed.

```bash
npm --prefix frontend run test
```

Also useful: a quick sanity match between two built-in agents,

```bash
PYTHONPATH=src python src/play.py -p greedy mcts -t 2
```

## Training

Training runs are driven by a YAML config passed to `train_v2.py`:

```bash
PYTHONPATH=src python src/train_v2.py experiments/<config>.yaml
```

Each run creates `runs/<run_id>-<timestamp>/`, with model checkpoints (and,
if `training.save_onnx` is set, matching `.onnx` exports) under
`models/checkpoints/`, plus self-play replay buffers and benchmark logs. A
run either stops itself if the config sets `training.finish_after`, or trains
indefinitely until interrupted.

`experiments/B5W2/cucu-01.yaml` is a proven recipe for a 5x5 board with 2
walls per player (a ResNet policy/value network, MCTS self-play, and periodic
tournament/dumb-score benchmarks). It logs to Weights & Biases, so it expects
you to be logged in (`wandb login`); without that it will fail trying to
authenticate. To run it without Weights & Biases, disable that section with
an override, which falls back to console-only metrics logging:

```bash
PYTHONPATH=src python src/train_v2.py experiments/B5W2/cucu-01.yaml -o wandb=None
```

`experiments/ci.yaml` is a much smaller config (an MLP network, a 2-minute
`finish_after`) useful for smoke-testing the training loop end to end.

The Rust engine also has a standalone self-play binary for benchmarking
throughput, given a config and a trained model:

```bash
scripts/bench_rust_selfplay.sh experiments/B5W2/cucu-01.yaml rust/fixtures/alphazero_B5W2_mv1.onnx 60
```

(the third argument is an optional duration in seconds, default 60; it builds
`rust/target/release/selfplay` with the `binary` feature on first use).

## Repo layout

| Path | Contents |
|---|---|
| `src/` | Python trainer: game env, agents, `v2/` training pipeline, play server |
| `rust/` | `quoridor-rs` (game logic + MCTS, PyO3 bindings), `quoridor-wasm/` (browser build), `fixtures/` (bundled model) |
| `frontend/` | Svelte SPA that plays a trained model client-side via `onnxruntime-web` |
| `test/` | Python test suite |
| `experiments/` | Training configs, including the `B5W2/` proven recipe and `ci.yaml` |
| `scripts/` | `bench_rust_selfplay.sh`, for throughput benchmarking |
| `coding-agents/` | Design notes and results from past feature work |
| `docs/superpowers/specs/` | Design docs for individual features |
| `docs/superpowers/plans/` | Step-by-step implementation plans for individual features |

## Further reading

Design rationale and implementation plans for individual pieces of this
project (the Rust self-play engine, the browser play server, ONNX export,
and more) live under:

- `docs/superpowers/specs/` — design docs, one per feature
- `docs/superpowers/plans/` — the step-by-step plans that implemented them

`rust/README.md` and `frontend/README.md` also cover their respective pieces
in more depth.
