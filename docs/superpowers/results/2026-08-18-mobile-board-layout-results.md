# Make the game page fit a phone screen

Chains onto #13 (`vibe/stats-lifecycle-cleanup`), which is this branch's base.

## The bug

On a phone, selecting the 9x9 model rendered a board wider than the screen. The
page could only be read by zooming out, which then shrank the control rail below
the board to an unusable size.

`Board.svelte` sized its grid in fixed pixels -- `--pawn-size: 54px`,
`--post-size: 14px` -- laid out as alternating fixed tracks, so a board of size
`n` always occupied

    n * 54 + (n - 1) * 14  px of tracks  +  16px of the board's own padding

no matter how much room there was. For n = 9 that is 614px, plus 32px of body
padding, so the page demanded 646 CSS px against a phone's ~390. For n = 5 the
same arithmetic gives 374px, which fits -- which is why only the larger model
showed the bug. There were no `@media` queries anywhere in `frontend/src`.

`SetupScreen.svelte` had the same class of bug in a milder form: `max-width:
420px` with `padding: 20px` under the default `content-box`, so the card was
460px wide and overflowed a phone too.

## The fix

Every track is now scaled by a factor `--u`:

    --u: min(1px, calc((100vw - var(--board-chrome, 48px)) / var(--board-units)))

`--board-units` is the unitless track total, written inline by the component
from `boardTrackUnits(n)` in `boardGrid.ts`; `--board-chrome` is the horizontal
space the board may not use (32px of body padding plus its own 16px). Two
properties of this were what recommended it:

- `min()` clamps the factor at exactly `1px`, so at any viewport at or above the
  board's natural width the rendering is byte-for-byte what it was before.
  Desktop cannot regress.
- It depends only on `100vw`, never on an ancestor's width, so there is no
  circular sizing between the page's flex layout and the board's grid.

`fr` tracks with a container-relative width is the more idiomatic fix, but the
board's cells are empty, so the grid's max-content width collapses to nearly
zero and the surrounding flex items would need definite `flex-basis` values to
size it correctly -- several interacting pieces, none of them checkable in a
container with no browser in it.

Alongside:

- `Replay.svelte` nests a board inside its own bordered, padded card, so it
  raises `--board-chrome` to match.
- `SetupScreen.svelte` gets `box-sizing: border-box`, so its 420px cap includes
  its padding.
- `ControlRail.svelte` may now shrink below its 240px rather than force it.

## Verification

Run in the devcontainer, all clean:

- `npx svelte-check --threshold error` -- 0 errors (1 pre-existing a11y warning
  about the cells' `tabindex`, untouched here).
- `npm --prefix frontend run test` -- 111 passed, including two new cases
  covering `boardTrackUnits`.
- `npm --prefix frontend run build` and `run check:build` -- both pass; the
  `min()` expression survives the build intact in `dist/assets/Board-*.css`.

**Not verified by machine:** there is no browser in this devcontainer, so
nothing here has been rendered. The arithmetic and the CSS are sound and the
desktop path is provably unchanged by the `min()` clamp, but the phone result
needs the manual check below. (A browser-automation setup was scoped out
separately and deliberately not built first.)

## How to check before/after on a phone

Both builds are already staged in `.phone-test/` in the working tree (gitignored,
99 MB -- delete it when done). The repo is bind-mounted, so they are visible on
the host at the same path.

**On the host**, from the repo root:

```
python3 -m http.server 8080 --bind 0.0.0.0 -d .phone-test
hostname -I | awk '{print $1}'     # the LAN address to type on the phone
```

**On the phone**, on the same Wi-Fi:

- before: `http://<that-address>:8080/before/lll_alpha_quoridor/`
- after:  `http://<that-address>:8080/after/lll_alpha_quoridor/`

On the setup screen pick the 9x9 model (`b9w10-v0`) and press **Start game**.
The `before/` build is the tip of #13; `after/` is this branch. Serving them
under a two-segment path prefix also exercises the relative-base handling that
GitHub Pages needs, so a root-absolute URL bug would show up here too.

Two things to expect, neither related to this change:

- Plain HTTP over the LAN is not a secure context, so `navigator.gpu` is
  unavailable and the WebGPU banner appears; the AI runs on the wasm CPU
  backend. Lower *MCTS sims* on the setup screen if it thinks too slowly.
- If the phone cannot reach the host, it is usually the host firewall:
  `sudo ufw allow 8080/tcp` (and revoke it afterwards).

To rebuild the staged copies later:

```
npm --prefix frontend run build
cp -r frontend/dist/. .phone-test/after/lll_alpha_quoridor/
```

## Follow-ups, deliberately not done here

- **Wall slots are hard to tap.** They scale with the board, so at a 390px
  viewport a wall half-slot is roughly 31x8 CSS px, against the ~44px usually
  recommended for touch.
- **Wall preview never appears on touch.** It is driven by `onmouseenter`, which
  a tap does not fire, so on a phone a tap places a wall with no preview step.

Both are touch *interaction* problems rather than layout ones, both need a design
decision, and neither can be judged without a real device in hand.
