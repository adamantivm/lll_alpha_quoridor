# Plan: browser automation in the devcontainer

I'm using AGENTS.md

## Goal

Give an agent working in this container a real browser, so frontend changes can
be verified by rendering them rather than by reasoning about CSS. Two recent
episodes motivate it: the wasm-CPU fallback that `frontend/README.md` says has
never been confirmed in a real browser, and the mobile board layout fix, whose
correctness could only be argued from arithmetic.

## What goes in

**The official Playwright CLI, not the MCP server.** `@playwright/cli`
(Microsoft, `microsoft/playwright-cli`) writes page snapshots to disk as YAML
and prints a file path, instead of streaming an accessibility tree into the
context on every call. It ships an official Claude Code skill, installed into
the workspace by `playwright-cli install --skills`, so the command surface is
loaded on demand rather than sitting in every prompt.

Verified working in this container before writing any of it down:

- `playwright-cli install-browser chromium --with-deps` pulls chromium plus 95
  apt packages.
- The default browser channel is `chrome` (branded), which is *not* installed
  and fails with "Chromium distribution 'chrome' is not found". The
  `.playwright/cli.config.json` that `install --skills` writes pins the channel
  to `chromium` and fixes this; without it every call needs `--browser chromium`.
- `--mobile` gives a genuine 360x732 / DPR 3 / touch context. `--device
  "iphone 15"` silently did nothing (stayed 1280x720), so `--mobile` is the flag
  to rely on.
- Driving the real app end to end works: setup screen, start a 9x9 game, board
  renders, 0 console errors, and the WebGPU-absent CPU fallback path runs.

## Changes

1. `.devcontainer/post-create.sh` - install `@playwright/cli` globally and the
   chromium browser with its system dependencies. Idempotent, and a warning
   rather than a hard failure if it can't: unlike rust, a missing browser does
   not make the container unusable, and it can be installed later by hand.
2. `.devcontainer/devcontainer.json` - mount a named volume at
   `~/.cache/ms-playwright` so the ~250MB browser download survives a rebuild. A
   named volume rather than a bind mount, because Docker creates a missing bind
   source as a root-owned directory, which is the failure `post-attach.sh`
   already documents for `~/.config/gh`.
3. `.claude/skills/playwright-cli/` and `.playwright/cli.config.json` - the
   official skill and the chromium channel config, both checked in so every
   clone and every rebuild has them without re-running the installer.
4. `.claude/settings.json` - allow `playwright-cli` bash calls without a
   permission prompt on every step of a browser check.
5. `scripts/serve-frontend.sh` - build-and-serve the static site under a path
   prefix, which is the form the deployed site actually takes. Today that recipe
   lives only in prose in `frontend/README.md`, and getting it wrong is exactly
   the bug class `check:build` exists to catch.
6. `.gitignore` - ignore `.playwright-cli/`, the per-session snapshot, console
   log and screenshot artifacts.
7. `AGENTS.md` - when to run a browser check, and when to include screenshots.
   This is the part that needs the user's approval, so it is proposed in the
   response rather than just committed.

## Verification

- Re-run the install steps against this live container and confirm they are
  idempotent.
- Drive the built frontend through `playwright-cli` at mobile size, capture
  before/after screenshots of the board fix, and look at them.
- Confirm `scripts/serve-frontend.sh` serves under the prefix and that the page
  loads with no console errors.

## Out of scope

A committed e2e test suite and a CI job. This change is about giving an agent
eyes during development; assertions that must stay green in CI are a separate
decision with separate maintenance, and GitHub's runners have no GPU so they
could only ever cover the CPU path anyway.
