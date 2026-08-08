# Frontend CI (PR 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a green PR mean a deployable frontend build, before PR 4 makes `main` deploy automatically.

**Architecture:** A composite action owns the fragile, expensive setup — Rust toolchain, `wasm-pack`, building `quoridor-wasm`, Node, and the `npm install` that depends on that wasm build having already happened. A workflow consumes it and runs the checks. PR 4's deploy consumes the same action, so the two cannot drift on the part that is actually hard to get right.

**Tech Stack:** GitHub Actions, Rust + `wasm-pack`, Node 20, Vite, vitest.

Spec: `docs/superpowers/specs/2026-08-07-static-frontend-github-pages-design.md` ("PR 3 — Frontend CI")

**Branch:** `vibe/frontend-ci`, from `main` (which now contains PRs 1 and 2).

## Global Constraints

- Commit messages start with `vibe: ` and an imperative subject, 50 chars max after the prefix. Body wrapped at 72 columns, explaining **why**. Do not enumerate changed files.
- Separate functional commits from formatting/lint commits.
- Never commit to `main`.
- `npm install`, **never `npm ci`**: the lockfile resolves `quoridor-wasm` by relative path against the `pkg/` directory `wasm-pack` produces, so `wasm-pack` must run first and `npm ci` would fail. This is documented in `README.md` and is the single most important ordering constraint in this PR.
- No changes to application source. This PR adds CI only.
- `JULIAN_NOTES.md` and `PEER_REVIEW.md` are the owner's untracked files. Leave them; never `git add -A` from the repo root.

---

## Design notes

**Why a composite action rather than duplicated steps.** The point of this PR
is the guarantee "green PR ⇒ deployable build". Two hand-maintained copies of
the build steps can drift silently, and the first symptom would be a failed
deploy on `main` after a green PR — exactly the guarantee dying. One shared
definition is what keeps it true.

**What belongs in the composite, and what doesn't.** It owns toolchain setup,
the `wasm-pack` build, and `npm install`: the parts that are version-sensitive,
slow, cached, and order-dependent. It deliberately does **not** run
`npm run build`, `npm test` or `check:build` — those are one-line, defined in
`package.json`, and each workflow needs a different subset. Putting them in
the composite would mean the Pages deploy runs the test suite it does not need,
and would hide which step failed behind a composite boundary.

**Node version.** Pinned to 20 (LTS). The repo pins nothing today and the
devcontainer floats, so CI would otherwise silently follow the runner image.
Vite 5 needs ≥18; pinning makes a Node bump a deliberate, reviewable change.

**Path filters.** The frontend build depends on `frontend/**` and on the Rust
crates that produce the wasm package. `src/`, `test/` and `experiments/` are
the Python trainer and cannot affect it, so they must not trigger this
workflow — the existing `python-app.yml` and `rust-ci.yml` already use the
same path-filtering convention.

## File Structure

**Created:**
- `.github/actions/setup-frontend/action.yml` — composite: Rust, `wasm-pack`, cargo cache, wasm build, Node, `npm install`.
- `.github/workflows/frontend-ci.yml` — consumes it, then runs the checks.

**Modified:**
- `frontend/README.md` — one line noting CI runs these same checks.

The composite is named `setup-frontend` rather than the spec's tentative
`build-frontend`, because it prepares the build environment rather than
producing the final artifact — the consuming workflow decides what to build.

---

### Task 1: The composite action

**Files:**
- Create: `.github/actions/setup-frontend/action.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: an action at `./.github/actions/setup-frontend` that, after running, leaves `rust/quoridor-wasm/pkg/` built and `frontend/node_modules/` installed. PR 4's deploy workflow will consume the same action.

- [ ] **Step 1: Write the action**

Create `.github/actions/setup-frontend/action.yml`:

```yaml
name: Set up the frontend build
description: >
  Rust toolchain, wasm-pack, the quoridor-wasm package, Node, and npm
  dependencies. Shared by the frontend CI workflow and the Pages deploy so the
  two cannot drift on the part that is actually order-dependent.

runs:
  using: composite
  steps:
    - name: Install Rust toolchain
      uses: dtolnay/rust-toolchain@stable

    - name: Cache cargo registry
      uses: actions/cache@v4
      with:
        path: ~/.cargo/registry
        key: ${{ runner.os }}-cargo-registry-${{ hashFiles('rust/Cargo.lock') }}
        restore-keys: |
          ${{ runner.os }}-cargo-registry-

    - name: Cache cargo git
      uses: actions/cache@v4
      with:
        path: ~/.cargo/git
        key: ${{ runner.os }}-cargo-git-${{ hashFiles('rust/Cargo.lock') }}
        restore-keys: |
          ${{ runner.os }}-cargo-git-

    - name: Install wasm-pack
      uses: jetli/wasm-pack-action@v0.4.0
      with:
        version: latest

    # Must precede npm install: the lockfile resolves quoridor-wasm by relative
    # path against the pkg/ directory this produces.
    - name: Build quoridor-wasm
      shell: bash
      run: wasm-pack build rust/quoridor-wasm --target web --release

    - name: Set up Node
      uses: actions/setup-node@v4
      with:
        node-version: "20"
        cache: npm
        cache-dependency-path: frontend/package-lock.json

    # npm install, not npm ci: ci would fail on the relative-path dependency
    # above, which the lockfile records against a directory that does not exist
    # until wasm-pack has run.
    - name: Install npm dependencies
      shell: bash
      run: npm --prefix frontend install
```

Every `run` step in a composite action needs an explicit `shell:` — omitting
it is the most common way a composite action fails to load, and the error
message points at the file rather than the step.

- [ ] **Step 2: Validate the YAML parses**

Run:
```bash
source .venv/bin/activate
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/actions/setup-frontend/action.yml')); print('parsed ok'); print('steps:', len(d['runs']['steps'])); print('shells:', [s.get('shell') for s in d['runs']['steps'] if 'run' in s])"
```
Expected: `parsed ok`, 7 steps, and every `run` step reporting `bash`.

- [ ] **Step 3: Commit**

```bash
git add .github/actions/setup-frontend/action.yml
git commit -m "vibe: share the frontend build setup

The Pages deploy is about to run the same toolchain dance as CI, and two
hand-maintained copies drift silently -- the first symptom being a
failed deploy on main right after a green PR.

The ordering here is the fragile part worth centralising: npm install
resolves quoridor-wasm by relative path, so it fails unless wasm-pack
has already produced the package."
```

---

### Task 2: The workflow

**Files:**
- Create: `.github/workflows/frontend-ci.yml`

**Interfaces:**
- Consumes: `./.github/actions/setup-frontend` from Task 1.
- Produces: a required-able check on PRs touching the frontend or the wasm crates.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/frontend-ci.yml`:

```yaml
name: Frontend CI

on:
  push:
    paths:
      - 'frontend/**'
      - 'rust/src/**'
      - 'rust/quoridor-wasm/**'
      - 'rust/Cargo.toml'
      - 'rust/Cargo.lock'
      - '.github/actions/setup-frontend/**'
      - '.github/workflows/frontend-ci.yml'
  pull_request:
    paths:
      - 'frontend/**'
      - 'rust/src/**'
      - 'rust/quoridor-wasm/**'
      - 'rust/Cargo.toml'
      - 'rust/Cargo.lock'
      - '.github/actions/setup-frontend/**'
      - '.github/workflows/frontend-ci.yml'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  check:
    name: Test and build
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up the frontend build
        uses: ./.github/actions/setup-frontend

      - name: Type check
        run: npm --prefix frontend exec svelte-check -- --threshold error

      - name: Unit tests
        run: npm --prefix frontend run test

      - name: Build
        run: npm --prefix frontend run build

      # Guards the regressions that build cleanly and only fail once deployed
      # under a path prefix: root-absolute asset URLs, a copy target that
      # silently stops matching, and a model directory missing its .onnx.
      - name: Check build output
        run: npm --prefix frontend run check:build
```

Order matters: type check and tests run before the build, so a failure names
the cheap step rather than being buried after a two-minute build.

`svelte-check --threshold error` is included deliberately. The repo has one
pre-existing accessibility *warning* in `Board.svelte`; `--threshold error`
means CI fails on errors while not being blocked by that warning.

- [ ] **Step 2: Validate the YAML parses and the action reference resolves**

```bash
source .venv/bin/activate
python3 - <<'PY'
import yaml, pathlib
w = yaml.safe_load(open('.github/workflows/frontend-ci.yml'))
steps = w['jobs']['check']['steps']
print('parsed ok, steps:', len(steps))
uses = [s['uses'] for s in steps if 'uses' in s]
print('uses:', uses)
local = [u for u in uses if u.startswith('./')]
for u in local:
    p = pathlib.Path(u.lstrip('./')) / 'action.yml'
    print(f'{u} -> {p} exists: {p.exists()}')
PY
```
Expected: parses, and every local `uses:` resolves to an existing
`action.yml`. A typo'd path here fails only on the runner, minutes in.

- [ ] **Step 3: Verify the checks the workflow runs actually pass locally**

The workflow is only worth adding if its steps pass on `main` today. Run
exactly what it runs:

```bash
npm --prefix frontend exec svelte-check -- --threshold error
npm --prefix frontend run test
npm --prefix frontend run build
npm --prefix frontend run check:build
```
Expected: 0 errors; 31 tests pass; build succeeds; `check:build OK`.

If `frontend/package-lock.json` shows as modified afterwards, do NOT commit
it — leave it unstaged and mention it.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/frontend-ci.yml
git commit -m "vibe: check the frontend on every pull request

Nothing ran npm test or npm run build outside a developer's machine, so
a broken frontend would have surfaced only when the Pages deploy failed
after merge -- leaving main undeployable and the site stale.

Running the same steps the deploy will run means a green pull request
is evidence the site can actually be built."
```

---

### Task 3: Documentation

**Files:**
- Modify: `frontend/README.md`

- [ ] **Step 1: Note CI in the README**

Read `frontend/README.md`. In its Tests section, add a short paragraph:

```markdown
These same checks — `svelte-check`, the unit tests, `npm run build` and
`npm run check:build` — run in CI on every pull request that touches
`frontend/` or the Rust crates the wasm package is built from, so a green PR
means the site can actually be built.
```

Keep it to that. The workflow file is the detail; the README only needs to
tell a contributor the checks are enforced.

- [ ] **Step 2: Commit**

```bash
git add frontend/README.md
git commit -m "vibe: say that CI enforces the frontend checks"
```

---

### Task 4: Verification and results

**Files:**
- Create: `docs/superpowers/results/2026-08-08-frontend-ci-results.md`

- [ ] **Step 1: Full verification sweep**

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

- [ ] **Step 2: Confirm the workflow will actually trigger on this PR**

The workflow's own path filters include `.github/workflows/frontend-ci.yml`,
so the PR that adds it triggers it. Confirm that is true by checking the
filter list contains that path — this is what makes the PR self-verifying,
and a workflow that cannot run on the PR introducing it is a workflow nobody
has seen work.

```bash
grep -c "frontend-ci.yml" .github/workflows/frontend-ci.yml
```
Expected: 2 (once under `push`, once under `pull_request`).

- [ ] **Step 3: Write the results file**

Create `docs/superpowers/results/2026-08-08-frontend-ci-results.md`, matching
the tone of `docs/superpowers/results/2026-08-07-static-frontend-results.md`
(read it first). Cover: what was unchecked before and what that risked once
Pages deploys from `main`; why the setup lives in a composite action and what
was deliberately left out of it; the `npm install` vs `npm ci` ordering
constraint and why it is the thing worth centralising; the pinned Node
version; the path filters and why the Python trainer is excluded; and that
the real gate is the workflow going green on its own PR.

- [ ] **Step 4: Commit, push, open the PR**

```bash
git add docs/superpowers/results/2026-08-08-frontend-ci-results.md
git commit -m "vibe: write up the frontend CI workflow"
git push -u origin vibe/frontend-ci
gh pr create --base main --title "vibe: check the frontend on every pull request" \
  --body-file docs/superpowers/results/2026-08-08-frontend-ci-results.md
```

Report the PR URL. **The gate for this PR is the workflow itself going green
on the PR.** Watch it with `gh pr checks --watch`; if it fails, the failure is
the deliverable's own bug, not an unrelated flake.

---

## Self-Review

**Spec coverage.** The spec's PR 3 section requires: a workflow on PRs and
pushes filtered to `frontend/**` and the Rust crates (Task 2); `npm install`
not `npm ci`, with the reason (Task 1, and stated in the composite's comment);
`npm test`, `npm run build`, `check:build` (Task 2); and the shared composite
action consumed later by PR 4's deploy (Task 1). The composite's name differs
from the spec's tentative `build-frontend`, with the reasoning recorded above.

**Placeholder scan.** No TBD/TODO; every file's full content is given, and
the one prose edit (Task 3) supplies its exact text.

**Type consistency.** Not applicable — no application code changes. The one
cross-file contract is the workflow's `uses: ./.github/actions/setup-frontend`
matching the action's directory, which Task 2 Step 2 verifies mechanically
rather than by eye.

**Every task leaves the repo working**: Tasks 1-3 only add CI configuration
and a README line, so nothing can break the application. The risk in this PR
is entirely "does the workflow run correctly on a runner", which only the PR
itself can answer.
