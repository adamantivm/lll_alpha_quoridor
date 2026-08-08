# Contributing

Conventions for branches, commits and pull requests live in
[AGENTS.md](AGENTS.md). This file covers the one task with steps you cannot
guess from the code.

## Adding a play model

Models are static data. The site at
<https://adamantivm.github.io/lll_alpha_quoridor/> reads them from
`frontend/models/`, one directory per model, collected at build time — there
is no index or registry to update.

[PR #8](https://github.com/adamantivm/lll_alpha_quoridor/pull/8) is a worked
example: three files, one commit.

### 1. Export the model to ONNX

Set `save_onnx: true` under `training` in your run's config (see
[MODEL_SAVE_OPTIONS.md](MODEL_SAVE_OPTIONS.md)). Checkpoints land in
`runs/<run_id>-<timestamp>/models/checkpoints/` alongside the `.pt` files.

### 2. Create the directory

```
frontend/models/<id>/
  model.onnx
  meta.json
```

The directory name is the model's id — use the existing shape, e.g.
`b9w10-v0` for a 9×9 board with 10 walls.

**The model file must be named exactly `model.onnx`.** The runtime URL is
built from the directory name, so any other filename produces a model that
404s in the browser. `npm --prefix frontend run check:build` fails with the
offending directory named if you get this wrong.

### 3. Write `meta.json`

```json
{
  "label": "9×9, 10 walls (v0)",
  "default": true,
  "board_size": 9,
  "max_walls": 10,
  "max_steps": 100,
  "defaults": {
    "mcts_n": 1000,
    "mcts_c_puct": 1.4,
    "leaf_parallelism": 8,
    "virtual_loss": 1
  }
}
```

| Field | Meaning |
|---|---|
| `label` | Shown in the model picker |
| `default` | Selected on load. Exactly one model should have `true` — flip the previous default to `false` in the same commit |
| `board_size`, `max_walls`, `max_steps` | The board this model was trained for |
| `defaults` | Starting MCTS settings; the config panel lets a player change them |

Nothing validates the board fields against the network, so they have to match
what you trained — a mismatch fails at inference time in the browser, not at
build time. The rest of the schema is checked: a missing or mistyped field
fails `npm --prefix frontend run test` with the model id and field named.

### 4. Build and check

```bash
npm --prefix frontend run build
npm --prefix frontend run check:build   # pairs every meta.json with its model.onnx
npm --prefix frontend run test
```

### 5. Play it locally

Serve the build under a path prefix, the way GitHub Pages does. Root-absolute
URL bugs pass at the root and only fail under a prefix, so this is the check
worth running:

```bash
rm -rf /tmp/pages && mkdir -p /tmp/pages/lll_alpha_quoridor
cp -r frontend/dist/. /tmp/pages/lll_alpha_quoridor/
python3 -m http.server 8080 -d /tmp/pages
# open http://localhost:8080/lll_alpha_quoridor/
```

Use `localhost` rather than a LAN address: WebGPU is only available in a
secure context, so any other host silently drops you onto the slower CPU path.

Pick your model, play a move, and confirm the board matches the size you
declared.

### 6. Open a pull request

Merging to `main` redeploys the site automatically.
