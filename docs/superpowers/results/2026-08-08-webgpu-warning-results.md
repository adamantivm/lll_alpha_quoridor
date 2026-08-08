# Warn when WebGPU is unavailable

Detects whether this browser can actually run WebGPU inference and, if not,
shows a persistent banner saying the AI will think more slowly. It does not
stop anyone from playing. This is PR 2 of five (revised); PR 1 is merged.

Design: `docs/superpowers/specs/2026-08-07-static-frontend-github-pages-design.md`
Plan: `docs/superpowers/plans/2026-08-08-webgpu-warning.md`

## The check

`frontend/src/lib/webgpu.ts` does more than test whether `navigator.gpu`
exists. It `await`s `requestAdapter()` and treats a null adapter as
unsupported, because the API can be present while the GPU is blocklisted, the
session is headless, or the browser is in a VM — none of which
`"gpu" in navigator` can see. The call is raced against a 10-second timeout,
because `requestAdapter()` can hang on a wedged GPU process, and this is the
one code path that runs on every visit in production.

**The check gates nothing.** The worker's `executionProviders` stays
`["webgpu", "wasm"]`, so onnxruntime falls back to its wasm-CPU backend on its
own without being asked anything. The check's only consumer is whether
`App.svelte` renders `WebGpuBanner.svelte` above the board. The app starts
immediately either way — no "checking…" state, no gate, no lazily-constructed
worker, no path where a bug in the detection stops someone from playing. That
is a smaller design than the one it replaces, not just a friendlier one.

## The reversal

This PR originally made WebGPU mandatory: no adapter, no app, an explanatory
refusal panel instead of the board. That shipped, and then broke immediately
for the person it was written for — the repo owner's own Chrome, on a machine
with a working GPU, cannot get a WebGPU adapter. Independent WebGPU test pages
confirmed the same negative result, so this isn't a bug in the detection; the
browser really can't do it. A requirement that locks the maintainer out of
their own project is a bug, not a requirement.

The detection code did not need to change. Only the reaction to a `false`
result did: from "refuse to start" to "warn and keep going." `webgpu.ts` and
its tests, including the timeout, carry over unchanged from the version that
was reviewed on the mandate branch.

## The payload reduction

`dist/ort/` still shrinks, for a reason independent of the mandate/fallback
decision. The worker imports `onnxruntime-web/webgpu`, whose entry point
requests `ort-wasm-simd-threaded.asyncify.{wasm,mjs}` beneath
`ort.env.wasm.wasmPaths`. **Which files get requested is decided by the entry
point and `wasmPaths`, not by the `executionProviders` list** — so narrowing
`vite.config.ts`'s copy glob to `*asyncify*` is correct whether or not the
wasm fallback is enabled.

That was worth checking rather than assuming, because an earlier draft of
this same PR narrowed the glob to `*jsep*` on the assumption that JSEP is what
the WebGPU execution provider uses. It isn't — JSEP is a different onnxruntime
backend. That draft shipped two files nothing fetches and dropped the two the
browser actually needs at runtime: a guaranteed production 404, and it passed
the build, vitest, svelte-check, *and* the then-current `check-build.mjs`
guard, because that guard only asserted "a jsep wasm file exists somewhere in
dist/ort/" — it could confirm the guess, not check it. This PR replaces that
guard: it now scans the built worker chunk for `ort-wasm*.{wasm,mjs}` string
literals and asserts `dist/ort/` contains exactly that set, no more and no
less, deriving the requirement from the artifact instead of hardcoding a
variant name.

With the fallback restored (`["webgpu", "wasm"]`, the actual shipped state),
a clean build was re-verified to request the same two files as before:

```
"ort-wasm-simd-threaded.asyncify-CvvOzbbq.wasm"   (hashed asset copy, Vite-resolved)
"ort-wasm-simd-threaded.asyncify.mjs"
"ort-wasm-simd-threaded.asyncify.wasm"

frontend/dist/ort/:
  ort-wasm-simd-threaded.asyncify.mjs
  ort-wasm-simd-threaded.asyncify.wasm

frontend/dist: 48M
```

Down from the four wasm builds and every `.mjs` variant PR 1 shipped
(93 MB of onnxruntime alone, ~114 MB total in `dist/`, all uploaded on every
Pages deploy).

## The single-threaded caveat

The wasm-CPU fallback runs single-threaded: onnxruntime needs
`SharedArrayBuffer` for threads, and that needs cross-origin isolation
(COOP/COEP headers), which GitHub Pages cannot send. `coi-serviceworker` can
forge those headers on a static host, but it's deferred — there's no
measurement yet showing the single-threaded search is actually too slow to
play against, and adding a service worker plus a first-load reload isn't free.
Recorded as a future improvement in `frontend/README.md`, with the reason
spelled out rather than just the idea.

## Verification

```
pytest (--ignore=test/os_pz_conversion_test.py)   89 passed
vitest                                             31 passed
svelte-check --threshold error                      0 errors
build                                          succeeded
check:build                             OK (1 model(s) bundled)
```

`test/os_pz_conversion_test.py` is excluded because it fails to import on
`main` identically — the venv's `open_spiel` no longer exposes
`algorithms.alpha_zero.model`. Pre-existing and unrelated to this branch.

`svelte-check` reports one PRE-EXISTING, unrelated a11y warning in
`Board.svelte` (`a11y_no_noninteractive_tabindex`); it is not new here and the
threshold is set to `error`, so it does not fail the check.

**Open browser gate**, same as PR 1's: nobody has confirmed in a real
non-WebGPU browser that the banner renders *and the game stays playable* on
the CPU path. Firefox with `dom.webgpu.enabled=false` in `about:config`, or
the maintainer's own Chrome, is the way to close this before merge — unit
tests cover `detectWebGpu`/`checkWebGpu` against a stubbed `navigator.gpu`,
but nothing here has driven an actual game against the wasm-CPU backend in a
browser tab.

## The remaining PRs

3. **Frontend CI** — `wasm-pack build` + `npm test` + `npm run build` +
   `check:build` on PRs, so a green PR means a deployable build.
4. **GitHub Pages** — enable Pages and add the deploy workflow.
5. **`CONTRIBUTING.md` + a better model** — the add-a-model walkthrough, with a
   real second model as the worked example.
