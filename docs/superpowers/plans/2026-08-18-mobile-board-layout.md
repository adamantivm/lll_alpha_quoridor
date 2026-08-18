# Plan: make the game page fit a phone screen

I'm using AGENTS.md

## Problem

On a phone, choosing the 9x9 model renders a board wider than the viewport. The
page can only be read by zooming out, which then shrinks the control rail below
the board to an unusable size.

## Diagnosis

`Board.svelte` sizes its grid in fixed pixels: `--pawn-size: 54px`,
`--post-size: 14px`, laid out as alternating fixed tracks. A board of size `n`
is therefore always

    n * 54 + (n - 1) * 14  px of tracks  +  16px of board padding

wide, regardless of the viewport. For n = 9 that is 614px, plus the 32px of body
padding from `app.css`, so the page needs 646 CSS px. A phone offers about 390.
For n = 5 the same arithmetic gives 374px, which is why only the 9x9 model shows
the bug.

There are no `@media` queries anywhere in `frontend/src`.

`SetupScreen.svelte` has the same class of bug in a milder form: `max-width:
420px` with `padding: 20px` under the default `content-box`, so the box occupies
460px + 32px of body padding = 492px.

## Approach

Scale the board's cell size with the viewport, capped at today's size, and keep
everything else as it is.

Introduce one unit variable on `.board`:

    --u: min(1px, (100vw - var(--board-chrome, 48px)) / var(--board-units))

`--board-units` is the unitless track total (`n*54 + (n-1)*14`) written inline by
the component, and `--board-chrome` is the horizontal space the board is *not*
allowed to use (48px = 32px body padding + 16px of the board's own padding).
`--pawn-size` and `--post-size` become `calc(54 * var(--u))` and
`calc(14 * var(--u))`.

Two properties make this safe to land without a browser to check it in:

- Above the natural width, `min()` clamps `--u` to exactly `1px`, so the desktop
  rendering is pixel-identical to today.
- It depends only on `100vw`, not on the width of any ancestor, so there is no
  circular sizing between the flex layout and the grid.

`Replay.svelte` nests a board inside its own bordered, padded card on the stats
page, so it overrides `--board-chrome` to a larger value.

## Why not the more idiomatic options

`fr` tracks with a container-relative width is the textbook fix, but the board's
cells are empty, so the grid's max-content width collapses to nearly zero and it
would need the surrounding flex items to carry definite `flex-basis` values to
size correctly. That is several interacting pieces to get right with no browser
in this container to check them in. Container query units (`cqw`) would also
work and were rejected only for being a bigger change than the problem needs.

## Changes

1. `frontend/src/lib/boardGrid.ts` - export the pawn/post ratio constants and a
   pure `boardTrackUnits(n)` helper, so the geometry stays with the rest of the
   board geometry rather than being duplicated in a component.
2. `frontend/src/lib/boardGrid.test.ts` - cover `boardTrackUnits`, including the
   9x9 case from the bug report.
3. `frontend/src/lib/Board.svelte` - write the three custom properties inline,
   derive `--u` in CSS, drop the hardcoded pixel sizes.
4. `frontend/src/lib/Replay.svelte` - override `--board-chrome` for the card the
   replay board sits in.
5. `frontend/src/lib/SetupScreen.svelte` - `box-sizing: border-box` so the
   420px cap includes its own padding.
6. `frontend/src/lib/ControlRail.svelte` - let the 240px rail shrink on a narrow
   screen instead of forcing that width.

## Out of scope (deliberately)

Wall slots scale with the board, so at a 390px viewport a wall half-slot is
about 31x8 CSS px - tappable only barely, against the ~44px usually recommended.
Wall preview is also driven by `onmouseenter`, which never fires on touch, so a
tap places a wall with no preview step. Both are touch *interaction* problems
rather than layout ones, they need a design decision, and neither can be
sensibly verified without a real device. Recorded as follow-up work.

## Verification

- `npm --prefix frontend exec svelte-check -- --threshold error`
- `npm --prefix frontend run test`
- `npm --prefix frontend run build` and `npm --prefix frontend run check:build`
- Manual before/after on a real phone, served from the host over the LAN;
  instructions go in the results document.
