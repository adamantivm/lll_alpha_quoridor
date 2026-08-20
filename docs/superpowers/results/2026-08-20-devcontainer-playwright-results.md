# Browser automation in the devcontainer

Gives an agent working in this container a real browser, so frontend changes can
be verified by rendering them instead of by reasoning about CSS.

![Quoridor running in the devcontainer's browser](https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/8472c7b4e513d0551dea0cb632f47c16a078241e/docs/superpowers/results/images/browser-verification/first-browser-check.png)

*A 9x9 game, built and served by `scripts/serve-frontend.sh --build` and driven
by `playwright-cli` -- no host involvement, no Chrome extension, nothing outside
the container. 0 console errors.*

## Why

Two recent episodes: `frontend/README.md` still says the wasm-CPU fallback has
never been confirmed in a real browser (which is why a dead 24MB asset cannot be
trimmed), and the mobile board layout fix in #14 could only be argued from
arithmetic. Neither is a hard problem -- there was just no browser here.

## What was installed

**The official Playwright CLI (`@playwright/cli`, `microsoft/playwright-cli`),
not the MCP server.** It writes page snapshots to disk as YAML and prints the
path, rather than streaming an accessibility tree into the model's context on
every call, and it ships an official Claude Code skill so its ~60 commands are
loaded on demand instead of sitting in every prompt.

- `.devcontainer/post-create.sh` installs the CLI and chromium (plus the ~95 apt
  packages it needs). It warns rather than aborting on failure: unlike rust, a
  missing browser does not make the container unusable.
- `.devcontainer/devcontainer.json` mounts a **named volume** at
  `~/.cache/ms-playwright`, so a rebuild does not re-download 655MB of browser
  binaries. A named volume rather than a bind mount, because Docker creates a
  missing bind source as a root-owned directory -- the trap `post-attach.sh`
  already documents for gh's config.
- `.claude/skills/playwright-cli/` and `.playwright/cli.config.json` are checked
  in. The config matters: the CLI defaults to the **branded Chrome** channel,
  which is not installed, so without it the very first call dies with
  "Chromium distribution 'chrome' is not found".
- `.claude/settings.json` allows `playwright-cli` calls without a prompt at every
  step of a check.
- `scripts/serve-frontend.sh` builds and serves the site **under a path prefix**,
  the way Pages serves it. That recipe previously existed only as prose in
  `frontend/README.md`, and getting it wrong hides the exact root-absolute URL
  bug `check:build` was written to catch.

## AGENTS.md rules added

1. **When to verify in a browser.** Whenever the rendered page can change; skip
   (and say so) when it cannot; run it after the type check, tests and build
   pass, never before; check the built site rather than the dev server, which
   does not work in this repo; read the console as well as the picture; use a
   phone viewport for anything touching layout; measure where a measurement
   exists; never report a check that was not run.
2. **When to include screenshots.** Before *and* after, same viewport and page
   state, since a lone "after" shows a page rather than a fix; actually open
   every image before citing it; commit under
   `docs/superpowers/results/images/<topic>/`; and link them by raw URL pinned
   to a commit SHA, because GitHub does not resolve repo-relative image paths in
   a PR body.

## Proof it works

Driven against the two builds from #14, at a 360x732 / DPR 3 / touch viewport.

Before the layout fix -- the board overflows and the page zooms out, clipping
the status line:

![board before](https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/fb524f6f373b3ab275f12449a1428beab449a587/docs/superpowers/results/images/browser-verification/board-mobile-before.png)

After -- the whole 9x9 board fits, the status wraps, the rail is readable:

![board after](https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/fb524f6f373b3ab275f12449a1428beab449a587/docs/superpowers/results/images/browser-verification/board-mobile-after.png)

Measured rather than eyeballed:

| | before | after |
|---|---|---|
| board width | 614px | 328px |
| effective layout viewport | 630px (zoomed out) | 360px |
| horizontal overflow | yes | no |

Two further results fell out of this, both things the container could not
previously answer:

- **The CPU fallback works.** The app detects no usable WebGPU adapter, shows
  its banner, falls back to the onnxruntime wasm backend, and plays -- 0 console
  errors. That is the confirmation `frontend/README.md` has been waiting for.
- **The wall tap targets really are too small.** `playwright-cli eval` reports
  wall half-slots at **28.2 x 7.3 CSS px** at phone width, against the ~44px
  usually recommended for touch. #14 flagged this as an estimate; it is now a
  measurement.

## A bug this branch introduced, and fixed

The first draft created the browser cache with
`sudo mkdir -p "$HOME/.cache/ms-playwright"`. Since `~/.cache` did not exist yet,
`mkdir -p` created *that* as root as well, and nothing else could write a cache
there afterwards:

- `wasm-pack build` failed with `Error: Permission denied (os error 13)` -- no
  path, no hint -- which takes down `scripts/serve-frontend.sh --build` and so
  every browser check.
- pip silently fell back to running uncached.

Post-create now claims the directories Docker already made rather than creating
them (a volume's mount point *and any missing parent* both arrive root-owned),
guarded by an ownership test so a rebuild does not walk 655MB of browser files
it already owns. It never runs `mkdir` on that path.

Same trap `post-attach.sh` documents for `~/.config/gh`, reached from the other
direction: there Docker created the root-owned directory, here the provisioning
script did.

## Findings worth knowing

- `--mobile` gives a genuine 360x732 / DPR 3 / touch context, and
  `--device="iPhone 15"` gives 393x659. Device names are case-sensitive, and an
  unknown one is ignored silently rather than reported: `--device "iphone 15"`
  left the viewport at 1280x720 while looking like it had worked.
- Snapshots, console logs and screenshots land in `.playwright-cli/`, now
  gitignored.
- Each rebuild reinstalls the ~95 apt packages chromium needs, which is the
  output visible during post-create. The 655MB of browser binaries are *not*
  re-downloaded -- that is what the named volume is for.

## Verified against two container rebuilds

| check | result |
|---|---|
| `playwright-cli` on PATH | 0.1.18, installed by post-create |
| browser cache | named volume `quoridor-playwright-cache`, ext4, owned by `vscode`, 655MB |
| chromium system deps | no missing packages |
| checked-in skill | loads from `.claude/skills/playwright-cli/` |
| chromium default channel | `.playwright/cli.config.json` applies; no `--browser` flag needed |
| rust / cargo / wasm-pack / node / npm / gh | all present |
| python venv | 3.12.3, torch 2.13.0+cu130 |
| `wasm-pack build` | fails before the ownership fix, succeeds after |
| `scripts/serve-frontend.sh --build` | builds and serves under the path prefix, HTTP 200 |
| end-to-end browser check | game playable, 0 console errors |
| `post-create.sh` re-run | exit 0, idempotent, browser download skipped, ownership preserved |

## To pick this up

**Rebuild the container** (Dev Containers: Rebuild Container). The named volume
mount and the post-create step only take effect on a rebuild.

## Out of scope

A committed e2e suite and a CI job. This is about giving an agent eyes during
development; assertions that must stay green in CI are a separate decision with
separate maintenance, and GitHub's runners have no GPU so they could only ever
cover the CPU path.
