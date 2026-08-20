# Verify the rebuilt devcontainer, and fix what the rebuild exposed

Chains onto #16 (`vibe/devcontainer-playwright`), which is this branch's base.

## The first browser check run from inside the devcontainer

A 9x9 game, built and served by `scripts/serve-frontend.sh --build` and driven
by `playwright-cli` -- no host involvement, no Chrome extension, nothing outside
the container:

![Quoridor running in the devcontainer's browser](https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/8472c7b4e513d0551dea0cb632f47c16a078241e/docs/superpowers/results/images/browser-verification/first-browser-check.png)

Board renders, both pawns placed, legal moves marked, control rail intact,
**0 console errors**, and the WebGPU-absent CPU fallback banner behaving as
designed.

## What the rebuild exposed

**`~/.cache` was left owned by root.** #16's post-create step ran
`sudo mkdir -p "$HOME/.cache/ms-playwright"`, and since `~/.cache` did not exist
yet, `mkdir -p` created *that* as root too. Nothing else could write a cache
there afterwards:

- `wasm-pack build` failed with `Error: Permission denied (os error 13)` --
  no path, no hint, and it takes down `scripts/serve-frontend.sh --build` and
  therefore every browser check.
- pip silently fell back to running uncached.

The fix claims the directories Docker already made rather than creating them.
Docker creates a volume's mount point *and any missing parent* as root, so both
are chowned, guarded by an ownership test so a rebuild does not walk 655MB of
browser files it already owns. Post-create no longer runs `mkdir` on that path
at all.

This is the same trap `post-attach.sh` documents for `~/.config/gh`, arrived at
from the other direction: there Docker created the root-owned directory, here
the provisioning script did.

## Corrected from #16

`--device` is not broken. The earlier `--device "iphone 15"` failure was
capitalisation: `--device="iPhone 15"` gives a correct 393x659 / DPR 3 / touch
context. Device names are case-sensitive, and an unknown name is **ignored in
silence** while leaving the 1280x720 desktop viewport in place -- which is the
part actually worth warning about, since it yields a desktop screenshot that
looks like a mobile one. AGENTS.md now says to confirm the viewport with
`playwright-cli eval` before calling a screenshot mobile.

## Verification performed

Against the freshly rebuilt container:

| check | result |
|---|---|
| `playwright-cli` on PATH | 0.1.18, installed by post-create |
| browser cache | named volume `quoridor-playwright-cache`, ext4, owned by `vscode`, 655MB |
| chromium system deps | no missing packages |
| checked-in skill | loads from `.claude/skills/playwright-cli/` |
| chromium default channel | `.playwright/cli.config.json` applies; no `--browser` flag needed |
| rust / cargo / wasm-pack / node / npm / gh | all present |
| python venv | 3.12.3, torch 2.13.0+cu130 |
| `wasm-pack build` | fails before the fix, succeeds after |
| `scripts/serve-frontend.sh --build` | builds and serves under the path prefix, HTTP 200 |
| end-to-end browser check | game playable, 0 console errors |
| `.devcontainer/post-create.sh` re-run | exit 0, idempotent, download skipped, ownership preserved |

`~/.cache` went from 1 entry to 3 (`fontconfig`, `ms-playwright`, `pip`) after the
fix, which is the clearest evidence the other tools were being blocked.

## Note

`.phone-test/` (99MB) is still in the working tree from #14's real-device
screenshot recipe. It is untracked and regenerable, and #14's results file
documents how to rebuild it, so it is left alone rather than deleted here --
`rm -rf .phone-test` when that PR is done with it.
