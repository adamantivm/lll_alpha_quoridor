# Results: PR #12 brought up to date with `main`

`main` moved on while [#12](https://github.com/adamantivm/lll_alpha_quoridor/pull/12)
was open — PR #11 landed the stats and replay page — and the two branches
collided in the two files where they had rewritten the same lines. `main` was
merged into `vibe/game-setup-screen` (merge commit `1dc809a`), leaving the
branch's four reviewed commits untouched.

Plan: [docs/superpowers/plans/2026-08-18-pr12-merge-conflicts.md](../plans/2026-08-18-pr12-merge-conflicts.md)

## The two conflicts

**`frontend/src/App.svelte`.** PR #11 put a nav link to `stats.html` between the
WebGPU banner and `<div class="layout">`; this branch had replaced that same
region with the `{#if !started}` setup-screen conditional. The nav now sits
*above* the conditional rather than inside the game branch, so the games page is
reachable from the setup screen too — which is where someone deciding what to
play against would look for it. `main`'s `.nav` styles merged in on their own,
and the `ConfigDrawer` reference this branch deletes went with the conflict.

**`README.md`.** Both sides rewrote the paragraph on what gets recorded: this
branch replaced the "recorded as `unknown` until a later change asks for one"
sentence with the nickname prompt, `main` added what the stats page publishes.
The resolution keeps both, and reads after `main`'s new stats-page link above it.

`frontend/README.md` and `stats-worker/README.md` overlap but merged on their
own; the merged text was read rather than assumed — this branch's "The nick"
section and `main`'s read-API section do not collide.

## Verification

Local, on the merged tree:

- `npm --prefix frontend run test` — 86 passed (9 files)
- `npx svelte-check` — 0 errors (1 pre-existing a11y warning in `Board.svelte`)
- `npm --prefix frontend run build` — clean, emits `index.html` and `stats.html`
- `npm --prefix frontend run check:build` — OK (2 models bundled)
- the nav link and `./stats.html` are present in the built `main-*.js`

CI on the pushed merge: Frontend CI and Stats worker CI both pass (4/4 checks).
`gh pr view 12` reports `MERGEABLE` / `CLEAN`.

Not run: a live browser pass over the merged app — no browser automation is
available in this environment. The merge changes one link's placement and no
behaviour, and it is covered structurally by the checks above, but clicking
through the setup screen and a started game is still worth a minute before merge.

## Note

The PR body quotes "57 passed" from before the merge; the suite is now 86 tests
with PR #11's included. Worth refreshing if the description is updated.
