# Check the frontend on every pull request

Adds a required-able GitHub Actions workflow that builds `quoridor-wasm`,
installs the frontend, type-checks it, runs its unit tests, builds it, and
runs its post-build assertions on every PR and push touching `frontend/` or
the Rust crates the wasm package is built from. This is PR 3 of five; PR 1
made the frontend static, PR 2 made WebGPU mandatory.

Design: `docs/superpowers/specs/2026-08-07-static-frontend-github-pages-design.md`
Plan: `docs/superpowers/plans/2026-08-07-static-frontend.md`

## Why

Nothing has ever run `npm test`, `svelte-check`, or `npm run build` outside a
developer's own machine. That was tolerable while the frontend was one of
several ways to play. It stops being tolerable once PR 4 wires up a GitHub
Pages deploy from `main`: a broken merge would leave the published site
stale, and the first anyone would hear about it is a failed deploy job or,
worse, no signal at all if the deploy step itself never runs. There was no
mechanism that could catch a broken frontend before it reached `main`.

## What changed

**`.github/actions/setup-frontend/action.yml`** — a composite action that
does the toolchain dance: Rust toolchain, cargo caches, `wasm-pack`, build
`quoridor-wasm`, set up Node, `npm --prefix frontend install`. It exists as
its own action rather than inline steps because PR 4's Pages deploy needs to
run the identical sequence. Two hand-maintained copies of a build with an
order dependency drift silently — the first symptom would be a failed deploy
on `main` right after a green PR, which is exactly the failure mode this PR
exists to prevent. Putting the sequence in one place means CI and deploy
either both work or both fail the same way.

**`.github/workflows/frontend-ci.yml`** — checks out, runs the composite
action, then type-checks, tests, builds, and runs `check:build`, in that
order. Type check and tests run before the two-minute build so a failure
names the cheap step instead of surfacing after the expensive one.

**`frontend/README.md`** — one paragraph in the Tests section stating that
these checks now run in CI on every PR, so a contributor doesn't have to go
looking for the workflow file to know the checks are enforced.

## The ordering constraint that shaped the whole design

`frontend/package-lock.json` resolves `quoridor-wasm` by relative path
against `rust/quoridor-wasm/pkg/`, a directory `wasm-pack build` creates —
before that, it doesn't exist. `npm ci` would fail outright against a
lockfile entry pointing at a missing directory; `npm install` tolerates it
because `wasm-pack` has already produced `pkg/` by the time the composite
action reaches the install step. This is the one fact this PR is actually
built around: the composite action's step order is the correctness
guarantee, and the comments in `action.yml` say so directly rather than
leaving the next reader to rediscover it by breaking the build.

## What was deliberately left out of the composite

The composite action does not run `svelte-check`, tests, `build`, or
`check:build`. Those stay in the workflow (and will presumably differ in
PR 4's deploy, which only needs `build`). The composite's job is narrowly
"get a working `node_modules` and `pkg/` on disk" — the part that is
actually shared and actually order-dependent. Bundling the verification
steps into the composite would make PR 4's deploy either duplicate them
anyway or silently skip verification it should have.

## The pinned Node version

Node 20, matching `actions/setup-node@v4`'s LTS default at the time of
writing. Nothing in the frontend needs a specific minor version; pinning the
major avoids a silent behavior change if GitHub rotates the runner's default
Node out from under an unpinned `setup-node` call.

## Path filters, and why the Python trainer is excluded

Both `push` and `pull_request` triggers filter to `frontend/**`, the Rust
crates the wasm package is built from (`rust/src/**`, `rust/quoridor-wasm/**`,
`rust/Cargo.toml`, `rust/Cargo.lock`), the composite action itself, and the
workflow file. The Python trainer (`src/`, `test/`) is out of scope — it has
its own workflow, `python-app.yml`, and nothing in this PR touches it. A
frontend-only PR should not wait on Rust CI's clippy and cross-language
tests, and vice versa.

The workflow file is in its own filter list on purpose: the PR that adds
`frontend-ci.yml` touches that exact path, so it triggers on its own PR
rather than being invisible until the next unrelated frontend change. That
self-trigger is the actual gate for this PR — see below.

## Verification

```
pytest                            89 passed
vitest                            31 passed
svelte-check --threshold error     0 errors
build                             succeeded
check:build                       OK (1 model bundled)
```

`test/os_pz_conversion_test.py` is excluded from that pytest run. It fails to
import on `main` identically — the venv's `open_spiel` no longer exposes
`algorithms.alpha_zero.model`. Pre-existing and unrelated to this branch.

`svelte-check` reports the one pre-existing accessibility warning in
`Board.svelte` and no errors; `--threshold error` is what makes CI fail on
errors without being blocked by that warning.

Both new YAML files were validated to parse, and the workflow's
`uses: ./.github/actions/setup-frontend` was checked to resolve to a real
`action.yml` on disk — a typo in that path fails only on a runner, minutes
into a job, not locally.

**None of this proves the workflow itself works.** A composite action that
parses and a shell sequence that succeeds on a developer's machine are not
the same as a job succeeding on a fresh `ubuntu-latest` runner with cold
caches, `jetli/wasm-pack-action` actually installing `wasm-pack`, and
`actions/cache` behaving as expected on its first run. The real gate for
this PR is the workflow going green on the PR that introduces it — that is
what the self-triggering path filter above is for, and it is the first time
anyone will have seen this sequence run on a GitHub Actions runner at all.

## The remaining PRs

4. **GitHub Pages** — enable Pages and add the deploy workflow, consuming
   `.github/actions/setup-frontend` from this PR.
5. **`CONTRIBUTING.md` + a better model** — the add-a-model walkthrough, with
   a real second model as the worked example.
