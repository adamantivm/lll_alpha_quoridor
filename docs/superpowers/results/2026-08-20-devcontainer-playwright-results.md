# Browser automation in the devcontainer

Gives an agent working in this container a real browser, so frontend changes can
be verified by rendering them instead of by reasoning about CSS.

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

- `.devcontainer/post-create.sh` installs the CLI and chromium (plus the 95 apt
  packages it needs). It warns rather than aborting on failure: unlike rust, a
  missing browser does not make the container unusable.
- `.devcontainer/devcontainer.json` mounts a **named volume** at
  `~/.cache/ms-playwright`, so a rebuild does not re-download ~250MB. A named
  volume rather than a bind mount, because Docker creates a missing bind source
  as a root-owned directory -- the trap `post-attach.sh` already documents for
  gh's config.
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

## Findings worth knowing

- `--mobile` gives a genuine 360x732 / DPR 3 / touch context, and
  `--device="iPhone 15"` gives 393x659. Device names are case-sensitive, and an
  unknown one is ignored silently rather than reported: `--device "iphone 15"`
  left the viewport at 1280x720 while looking like it had worked.
- Snapshots, console logs and screenshots land in `.playwright-cli/`, now
  gitignored.

## AGENTS.md rules added

Two blocks, both proposed for review rather than assumed:

1. **When to verify in a browser.** Whenever the rendered page can change; skip
   (and say so) when it cannot; run it after the type check, tests and build
   pass, never before; check the built site rather than the dev server, which
   does not work in this repo; read the console as well as the picture; use
   `--mobile` for anything touching layout; measure where a measurement exists;
   never report a check that was not run.
2. **When to include screenshots.** Before *and* after, same viewport and page
   state, since a lone "after" shows a page rather than a fix; actually open
   every image before citing it; commit under
   `docs/superpowers/results/images/<topic>/`; and link them by raw URL pinned
   to a commit SHA, because GitHub does not resolve repo-relative image paths in
   a PR body.

## To pick this up

**Rebuild the container** (Dev Containers: Rebuild Container). The named volume
mount and the post-create step only take effect on a rebuild. First rebuild
downloads chromium; later ones reuse the volume.

## Out of scope

A committed e2e suite and a CI job. This is about giving an agent eyes during
development; assertions that must stay green in CI are a separate decision with
separate maintenance, and GitHub's runners have no GPU so they could only ever
cover the CPU path.
