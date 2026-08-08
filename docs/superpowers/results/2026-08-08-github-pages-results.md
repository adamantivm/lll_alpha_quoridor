# Publish the site to GitHub Pages

Adds the deploy workflow that puts the game live at
<https://adamantivm.github.io/lll_alpha_quoridor/>. This is PR 4 of five;
PR 1 made the frontend static, PR 2 added the WebGPU warning banner, and
PR 3 added CI. The rest are listed in PR 1's write-up.

Design: `docs/superpowers/specs/2026-08-07-static-frontend-github-pages-design.md`
Plan: `docs/superpowers/plans/2026-08-07-static-frontend.md`

## Why

The site has been buildable as a static site for three PRs without being
reachable by anyone who hasn't cloned the repo, which was the point of
making it static in the first place. Pages was already enabled on the repo
in "GitHub Actions" mode — the repo owner authorised that API call before
this PR was planned — so the only remaining piece is the workflow that
actually builds and publishes it.

## What changed

**`.github/workflows/pages.yml`**, a new workflow, separate from
`frontend-ci.yml`:

- **Trigger:** `push` to `main`, filtered to the same paths as
  `frontend-ci.yml` (`frontend/**`, the Rust crates the wasm package is
  built from, `.github/actions/setup-frontend/**`, and the workflow's own
  file — so editing the deploy logic redeploys), plus `workflow_dispatch`
  for a manual re-run. It intentionally does **not** run on the Python
  trainer (`src/`, `experiments/`, `test/`): the site has no dependency on
  training code, and triggering a Pages deploy on every unrelated Python
  commit would just add noise and quota use.
- **Two jobs.** `build` produces the artifact; `deploy` uploads it via
  `actions/deploy-pages@v4`, gated with `needs: build` and
  `environment: github-pages`. Splitting them is what `deploy-pages`
  requires — it deploys a previously uploaded artifact rather than building
  one itself — and it keeps the `pages`/`id-token` permissions scoped to the
  step that actually needs them.
- **The build job re-runs the same checks CI runs on pull requests**
  (`svelte-check`, unit tests, `build`, `check:build`) before uploading.
  Two changes can each pass their own PR and still break `main` together
  (a stale branch merged after a conflicting change, for instance), and a
  failure here leaves the previous deployment serving instead of publishing
  a broken site — `deploy-pages` never runs if `build` fails.
- **Reuses `.github/actions/setup-frontend` unchanged**, the composite
  action PR 3 introduced (Rust toolchain, `wasm-pack`, the `quoridor-wasm`
  build, Node 20, `npm install`). Two workflows building the same wasm
  package from two different sets of steps is exactly the drift that
  action exists to prevent.
- **Concurrency group `pages`, `cancel-in-progress: false`.** Two deploys
  racing would be confusing at best; refusing to run at all would block
  emergency redeploys. Not cancelling a running deploy mid-flight means a
  second push waits for the first deploy to finish rather than potentially
  leaving Pages serving a half-uploaded artifact.
- **`upload-pages-artifact` points at `frontend/dist`**, confirmed after a
  build to contain `index.html` directly (see Verification below) — pointing
  one level too high would publish a directory listing instead of the app.
- **No `.nojekyll` file.** The Actions deployment path does not run Jekyll,
  so underscore-prefixed paths (none currently exist, but nothing rules
  future ones out) are not at risk the way they would be on the legacy
  branch-based Pages deploy.

**`README.md`** gains a link to the live site directly under the opening
description — the single most useful line in the file for a visitor arriving
without local setup.

**`frontend/README.md`** gains a "Deployment" section describing the
trigger and the re-run-CI-before-publish behaviour, plus a "Verifying a
deployment" subsection with the one check that can only be done against the
live site: confirming `ort/*.mjs` is served with a JavaScript content type.
onnxruntime loads that file with a dynamic `import()`, so a wrong content
type fails as a module-type error rather than a 404, and the local
`python3 -m http.server` recipe in the "Run" section always serves `.mjs`
correctly — it cannot catch this class of bug even in principle, because the
bug is specific to how GitHub Pages' server (or any other host) sets
headers.

## This PR cannot be fully verified before merge

Unlike PR 3, this workflow does not run on the pull request that adds it —
it triggers on `push` to `main`, and GitHub does not run `push` workflows
against a PR's diff. So there is no green check here proving the deploy
half works. What there is instead:

- **YAML validation** (below) confirms the workflow parses, declares the
  right jobs, permissions and concurrency settings, and that the local
  action reference resolves to a real `action.yml`.
- **The build half is identical to `frontend-ci.yml`**, which has run green
  on every recent PR — same composite action, same four check steps, same
  commands.
- **The artifact path was confirmed against a real build** (below), not
  just read off the YAML.

What is *not* verified: that `actions/upload-pages-artifact` and
`actions/deploy-pages` actually hand off correctly in this repo, that the
`github-pages` environment is configured the way the workflow expects, and
that the published site is reachable and playable. The real gate is the
first run of this workflow after merging to `main` — see "Post-merge gate"
below.

## Verification

### YAML validation and action reference (Task 1 Step 2)

```
jobs: ['build', 'deploy']
permissions: {'contents': 'read', 'pages': 'write', 'id-token': 'write'}
concurrency: {'group': 'pages', 'cancel-in-progress': False}
  ./.github/actions/setup-frontend exists=True
deploy needs: build
```

Two jobs, both required permissions present, concurrency group `pages`
with `cancel-in-progress: False`, the composite action path resolves to a
real `action.yml`, and `deploy` declares `needs: build`.

### Artifact path (Task 1 Step 3)

```
$ npm --prefix frontend run build
...
✓ built in 690ms
$ ls frontend/dist/index.html && echo "artifact path frontend/dist is correct"
frontend/dist/index.html
artifact path frontend/dist is correct
```

`frontend/dist` is the directory `index.html` lives in directly, which is
what `upload-pages-artifact` needs — one level higher and Pages would serve
a directory listing instead of the app.

### Full sweep (Task 3 Step 1)

```
pytest                            89 passed
vitest                            31 passed
svelte-check --threshold error     0 errors (1 pre-existing Board.svelte a11y warning)
build                             succeeded
check:build                       OK (1 model bundled)
```

`test/os_pz_conversion_test.py` is excluded from the pytest run — it fails
to import on `main` identically (the venv's `open_spiel` no longer exposes
`algorithms.alpha_zero.model`). Pre-existing and unrelated to this branch.
The `Board.svelte` a11y warning predates this PR and is unrelated to the
deploy workflow.

## Post-merge gate

Not part of this PR, but the actual verification, to run once this lands
on `main`:

1. Watch the first `Deploy to GitHub Pages` run (`gh run watch`).
2. Load <https://adamantivm.github.io/lll_alpha_quoridor/> and play a move.
3. Run the `.mjs` content-type check documented in `frontend/README.md`:
   ```bash
   curl -sI https://adamantivm.github.io/lll_alpha_quoridor/ort/ort-wasm-simd-threaded.asyncify.mjs \
     | grep -i content-type
   ```
   It must report a JavaScript type.
4. Confirm the WebGPU banner behaves as it does locally — for the repo
   owner, whose Chrome cannot run WebGPU, the banner should appear and the
   game should still be playable on the CPU path.

## Note on this PR's own CI

`frontend-ci.yml`'s path filters include `.github/actions/setup-frontend/**`
among others; this PR touches neither that action nor any other filtered
path (only `README.md`, `frontend/README.md`, the results file, and the new
`pages.yml`, which is not among `frontend-ci.yml`'s filters). So it is
expected, not a failure, if `Frontend CI` does not run on this PR — the
deploy workflow itself cannot run at all until this merges to `main`.
