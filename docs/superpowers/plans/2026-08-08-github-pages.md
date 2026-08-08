# GitHub Pages Deploy (PR 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the game at `https://adamantivm.github.io/lll_alpha_quoridor/`, redeploying automatically when the frontend changes on `main`.

**Architecture:** A workflow reusing PR 3's `setup-frontend` composite action, running the same checks CI runs, then uploading `frontend/dist` as a Pages artifact and deploying it. Split into a build job and a deploy job, which is the shape GitHub's Pages actions expect and what surfaces the deployed URL in the run summary.

**Tech Stack:** GitHub Actions, `actions/upload-pages-artifact`, `actions/deploy-pages`.

Spec: `docs/superpowers/specs/2026-08-07-static-frontend-github-pages-design.md` ("PR 4 — GitHub Pages")

**Branch:** `vibe/github-pages`, from `main` (PRs 1–3 merged).

## Global Constraints

- Commit messages start with `vibe: ` and an imperative subject, 50 chars max after the prefix. Body wrapped at 72 columns, explaining **why**. Do not enumerate changed files.
- Never commit to `main`.
- No application source changes. This PR adds a workflow and documentation.
- Reuse `./.github/actions/setup-frontend`. Do not re-implement its steps — the reason it exists is that two copies of the toolchain setup drift.
- `JULIAN_NOTES.md` and `PEER_REVIEW.md` are the owner's untracked files. Leave them; never `git add -A` from the repo root.

## Already done, outside this PR

Pages is **already enabled** in "GitHub Actions" mode, by explicit authorisation from the repo owner:

```
gh api repos/adamantivm/lll_alpha_quoridor/pages -X POST -f build_type=workflow
→ build_type: "workflow", html_url: "https://adamantivm.github.io/lll_alpha_quoridor/", status: null
```

`status: null` means nothing has been published yet. The first successful run
of this workflow is what puts the site live. No further manual setup is
needed.

---

## Design notes

**Why the deploy runs the full check suite, not just a build.** PR 3 made a
green PR mean a deployable build, but two PRs that each pass independently can
still break `main` together. The published site is the thing users see, so the
deploy re-runs type check, tests, build and `check:build` before uploading.
If any fail, the deploy fails and **Pages keeps serving the previous
successful deployment** — a stale site, not a broken one. That is the right
failure mode, and it costs about thirty seconds.

**Why two jobs.** `actions/deploy-pages` is designed to run in a job with
`environment: github-pages`, which is what gives the run its deployment URL
and lets branch/environment protections apply. Splitting build from deploy
also means an artifact is only published if the build job fully succeeded.

**Concurrency.** `group: pages` with `cancel-in-progress: false`. Two merges
in quick succession must not race, and cancelling a deploy *mid-flight* is
worse than letting it finish — the second run then supersedes it cleanly.

**Path filters** match PR 3's, plus this workflow file. A commit touching only
the Python trainer cannot change the site, so it must not spend a Rust + wasm
build redeploying identical output.

## File Structure

**Created:**
- `.github/workflows/pages.yml`

**Modified:**
- `README.md` — link the live site near the top, where someone landing on the repo will see it.
- `frontend/README.md` — note that `main` auto-deploys, and add the `.mjs` MIME check to the live-site verification.

---

### Task 1: The deploy workflow

**Files:**
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: `./.github/actions/setup-frontend` (from PR 3).
- Produces: a deployment at `https://adamantivm.github.io/lll_alpha_quoridor/`.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/pages.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
    paths:
      - 'frontend/**'
      - 'rust/src/**'
      - 'rust/quoridor-wasm/**'
      - 'rust/Cargo.toml'
      - 'rust/Cargo.lock'
      - '.github/actions/setup-frontend/**'
      - '.github/workflows/pages.yml'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

# One deploy at a time. Not cancel-in-progress: interrupting a deploy midway
# is worse than letting it finish and having the next run supersede it.
concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    name: Build the site
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up the frontend build
        uses: ./.github/actions/setup-frontend

      # Re-run the same checks CI runs on pull requests. Two PRs that each
      # pass alone can still break main together, and a failure here leaves
      # the previous deployment serving rather than publishing a broken site.
      - name: Type check
        run: npm --prefix frontend exec svelte-check -- --threshold error

      - name: Unit tests
        run: npm --prefix frontend run test

      - name: Build
        run: npm --prefix frontend run build

      - name: Check build output
        run: npm --prefix frontend run check:build

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: frontend/dist

  deploy:
    name: Deploy
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

No `.nojekyll` file is needed: the Actions deployment path does not run
Jekyll at all, so underscore-prefixed paths are not at risk.

- [ ] **Step 2: Validate the YAML and the action reference**

```bash
source .venv/bin/activate
python3 - <<'PY'
import yaml, pathlib
w = yaml.safe_load(open('.github/workflows/pages.yml'))
print('jobs:', list(w['jobs']))
print('permissions:', w['permissions'])
print('concurrency:', w['concurrency'])
for job, spec in w['jobs'].items():
    for s in spec['steps']:
        u = s.get('uses')
        if u and u.startswith('./'):
            p = pathlib.Path(u[2:]) / 'action.yml'      # slice, not lstrip:
            print(f'  {u} exists={p.exists()}')          # lstrip strips chars
print('deploy needs:', w['jobs']['deploy']['needs'])
PY
```
Expected: two jobs (`build`, `deploy`); `pages: write` and `id-token: write`
present; concurrency group `pages` with `cancel-in-progress: False`; the local
action path exists; `deploy` needs `build`.

Note the `u[2:]` slice. `lstrip('./')` strips *characters*, so it eats the
leading dot of `.github` and reports a false negative — that bug was caught in
PR 3 and is not worth repeating.

- [ ] **Step 3: Confirm the artifact path is right**

The upload path must be the directory containing `index.html`, not its parent.

```bash
npm --prefix frontend run build
ls frontend/dist/index.html && echo "artifact path frontend/dist is correct"
```
Expected: the file exists.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "vibe: publish the site from main

The game has been buildable as a static site for three PRs without
being reachable by anyone who has not cloned the repo, which was the
point of making it static in the first place.

The deploy repeats the pull-request checks because two changes that
each pass alone can still break main together, and a failure here
leaves the previous deployment serving instead of publishing a broken
site."
```

---

### Task 2: Documentation

**Files:**
- Modify: `README.md`, `frontend/README.md`

- [ ] **Step 1: Link the live site from the root README**

Read `README.md`. Directly under the opening description paragraph, add:

```markdown
**▶ Play it: <https://adamantivm.github.io/lll_alpha_quoridor/>** — runs
entirely in your browser, no install required.
```

This is the single most useful line in the file for a visitor, so it goes
near the top rather than in a section further down.

- [ ] **Step 2: Update `frontend/README.md`**

Read the file. Add to the section describing how the site is served:

````markdown
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
````

- [ ] **Step 3: Commit**

```bash
git add README.md frontend/README.md
git commit -m "vibe: point readers at the live site"
```

---

### Task 3: Verification and results

**Files:**
- Create: `docs/superpowers/results/2026-08-08-github-pages-results.md`

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

- [ ] **Step 2: Write the results file**

Create `docs/superpowers/results/2026-08-08-github-pages-results.md`, matching
the tone of `docs/superpowers/results/2026-08-07-static-frontend-results.md`
(read it first). Cover: that Pages is already enabled in Actions mode and by
whom; the trigger and why the Python trainer is excluded from it; why the
deploy re-runs the checks and what happens on failure; the two-job split; the
concurrency choice; the live URL; and the post-merge verification, including
the `.mjs` content-type check that no local test can perform.

Be explicit that this PR cannot be fully verified before merge: the deploy
only runs on `main`, so the real gate is the first run after merging.

- [ ] **Step 3: Commit, push, open the PR**

```bash
git add docs/superpowers/results/2026-08-08-github-pages-results.md
git commit -m "vibe: write up the Pages deploy"
git push -u origin vibe/github-pages
gh pr create --base main --title "vibe: publish the site to GitHub Pages" \
  --body-file docs/superpowers/results/2026-08-08-github-pages-results.md
```

Report the PR URL.

Note the frontend CI workflow from PR 3 **will** run on this PR — its path
filters include `.github/actions/setup-frontend/**`, and while this PR does
not change that action, it does not match the other filters either. If CI
does not trigger, that is expected and not a failure; the deploy workflow
itself cannot run until merge.

---

## Post-merge gate

Not part of the PR, but the actual verification:

1. Watch the first `Deploy to GitHub Pages` run on `main` (`gh run watch`).
2. Load `https://adamantivm.github.io/lll_alpha_quoridor/` and play a move.
3. Run the `.mjs` content-type check above.
4. Confirm the WebGPU banner behaves as it does locally — for the repo owner,
   whose Chrome cannot run WebGPU, the banner should appear and the game
   should still be playable on the CPU path.

---

## Self-Review

**Spec coverage.** The spec's PR 4 section requires: reuse of the composite
action (Task 1), `upload-pages-artifact` + `deploy-pages` (Task 1),
`pages: write` / `id-token: write` permissions (Task 1), a concurrency group
(Task 1), push-to-`main` filtered to the same paths as PR 3 plus
`workflow_dispatch` (Task 1), and no `.nojekyll` (noted in Task 1). The
spec's "requires a manual step" is already satisfied — Pages was enabled by
API with the owner's authorisation before planning.

**Placeholder scan.** No TBD/TODO. Both prose edits give their exact text.

**Type consistency.** Not applicable — no application code. The cross-file
contract is `uses: ./.github/actions/setup-frontend` matching PR 3's action
directory, verified mechanically in Task 1 Step 2.

**Deliberate limitation:** unlike PR 3, this PR is not self-verifying. A
`push`-to-`main` workflow cannot run on the pull request that adds it, so
correctness before merge rests on YAML validation and on the fact that the
build half is identical to the CI workflow already proven green. The results
file must say so plainly rather than implying the deploy has been exercised.
