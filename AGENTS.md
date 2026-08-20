At the top of the plan always say "I'm using AGENTS.md"

Always separate commits between actual function change and formatting / linting. Create one commit with the actual functional changes, and then another separate
commit with only the formatting and linting changes. This will make it easier for reviewers to review the functionality first and the formatting separately.

whenever you need to use python, remember to activate the virtualenv which is in the .venv directory in the root of the repo.

Whenever you commit to git, follow these commit message guidelines:
- Start the subject line with "vibe: " followed by a summary in imperative mood
  (e.g. "vibe: add feature" not "vibe: added feature").
- Keep the subject line to 50 characters max (not counting the "vibe: " prefix).
- For non-trivial changes, add a body separated by a blank line from the subject.
  Wrap body lines at 72 characters. Focus on **why** the change was made, not
  what files were changed (the diff shows that).
- Do not enumerate modified files in the commit message.

Never commit directly to `main`. Every change, however small, goes through a feature
branch and a pull request on this same repository:
- Branch off the current `main` before the first commit, naming the branch
  `vibe/<short-kebab-case-topic>` (e.g. `vibe/devcontainer-fixes`).
- Commit to that branch following the message guidelines above.
- Push the branch to `origin` and open a PR against `main` with `gh pr create`, using the
  results markdown file (see the last rule below) as the PR body. Report the PR URL.
- Keep each PR small and scoped to one change. Do not merge it yourself unless asked.
- If pushing or `gh` is unavailable (no credentials, no network), stop after committing on
  the branch and say exactly what is left to do -- never fall back to committing on `main`.

Whenever you change rust files, before commit, make sure to run cargo fmt to format all files and then check formatting, build and run before committing.

Rules specific to the rust implementation (rust folder):
 - Whenever possible, keep compatibility with the python version implemented in src
 - keep clear separation of responsibilities. e.g.: game state functions in game_state.rs

Verify frontend changes in a real browser. The devcontainer has the official Playwright
CLI (`playwright-cli`); follow the skill in `.claude/skills/playwright-cli/`. If the
command is missing, re-run `.devcontainer/post-create.sh`.
- Do it whenever the change can alter what a user sees or can do: Svelte components, CSS,
  `index.html` or `stats.html`, the worker, wasm or ONNX loading, or the wiring between
  them. `svelte-check`, vitest and `check:build` say nothing about whether the page renders.
- Skip it when the rendered page cannot change -- python, rust the frontend does not
  consume, docs, CI config. Say that you skipped it and why; do not silently omit it.
- Run it at the *end* of verification: after the type check, the unit tests and the build
  pass, and before writing the results file. Do not point a browser at a build that does
  not compile.
- Check the built site, never the dev server -- `npm --prefix frontend run dev` does not
  work in this repo (see frontend/README.md). Use `scripts/serve-frontend.sh --build`.
- Read the console as well as the picture: `playwright-cli console error`. A page can look
  right and still be throwing.
- For anything touching layout, check a phone viewport as well as the default desktop one:
  `--mobile` (360x732, DPR 3, touch) or `--device="iPhone 15"` (393x659). Device names are
  case-sensitive and an unknown one is ignored *in silence*, leaving you on the 1280x720
  desktop viewport -- so confirm the viewport with `playwright-cli eval` before trusting a
  screenshot you are about to call mobile.
- Confirm the specific thing that changed, and measure it where a measurement exists: a
  bounding box from `playwright-cli eval` beats an impression that it looks right.
- Session artifacts land in `.playwright-cli/` (gitignored). Close the browser when done:
  `playwright-cli close`.
- Never report a browser check you did not run.

Include screenshots when the change is visual and a reviewer would otherwise have to take
your word for it.
- Capture before *and* after, from the same viewport and the same page state. An "after"
  on its own shows a page, not a fix.
- Look at every screenshot you take -- actually read the image file -- before citing it.
  Describing a screenshot you have not opened is the same as inventing it.
- Commit them under `docs/superpowers/results/images/<topic>/` and reference them from the
  results markdown.
- GitHub does not resolve repository-relative image paths in a PR body. Link them by raw
  URL pinned to the commit that added them, so the PR renders and goes on rendering after
  the branch is deleted:
  `https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/<commit-sha>/docs/superpowers/results/images/<topic>/before.png`
- Keep them cheap: a mobile viewport shot is about 40KB. Do not commit videos or traces.

If the work is relatively large, write one commit per change, so that the updates are easier to understand and review.

Always write the plan to file as a markdown file before starting implementation.

When you finish, write the results of what you did on a markdown file so that its contents can be written in a PR request.