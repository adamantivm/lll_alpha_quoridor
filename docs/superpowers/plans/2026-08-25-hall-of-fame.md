# Hall of fame — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, above `Start game`, the five most recent human victories against the selected model, in prose — plus a footer link to the source repository on both pages.

**Architecture:** Two new query parameters on the worker's existing list endpoint (`outcome`, `model_id`) let the play page ask one narrow question instead of downloading the history. The frontend keeps the answer honest by revalidating every row it gets back, because the page can be live against a worker whose deploy is still waiting for an approval click. Prose lives in a pure module so it is tested without a DOM; the component is a thin fetch-and-render shell.

**Tech Stack:** Cloudflare Workers + D1, Svelte 5 (runes), TypeScript, vitest, wrangler, playwright-cli.

Design: `docs/superpowers/specs/2026-08-24-hall-of-fame-design.md`

## Global Constraints

- **Worker and frontend ship in one pull request.** The worker deploys from CI now (`stats-worker-deploy.yml`), gated on an approval click. No schema change is needed — `outcome` and `model_id` are existing columns — so **no migration file is added**.
- The block filters by **model only**, never by level. Each sentence names its own level.
- Sentence shape: `{nick} won as {P1|P2} on {Level} in {N} moves, {D Mon YYYY}.` `human_player === 0` is **P1**. A `preset` of `"custom"` reads `on custom settings`; `"unknown"` reads `on an unknown level`.
- Games with takebacks (`undo_count > 0`) count. Do not filter them.
- Five rows: `RECENT_WINS_LIMIT = 5`.
- The block renders **nothing at all** — no spinner, no error text — when the endpoint is unset, the request is in flight, or the request failed. Only two visible states: the sentences, or the zero-wins line.
- Node 22 for the worker tests (`sql.test.ts` uses `node:sqlite` and skips itself silently on older runtimes). The frontend suite runs on the repo's default Node.
- Repository URL: `https://github.com/adamantivm/lll_alpha_quoridor`.
- Commit messages: `vibe: ` prefix, imperative, ≤50 chars after the prefix, body wrapped at **72 columns** explaining why, `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` trailer. Do not enumerate changed files. Verify with `git log -1 --format=%B | awk '{ if (length($0) > 72) print "OVER:", length($0), $0 }'`.
- Functional changes and formatting/linting changes go in separate commits (AGENTS.md).
- Branch `vibe/hall-of-fame`, PR against `main`. Never commit to `main`. **No wrangler command that contacts the Cloudflare API** — there is no token in the dev environment and there must not be one.

---

### Task 1: Two filters on the worker's list endpoint

**Files:**
- Modify: `stats-worker/src/sql.ts`
- Test: `stats-worker/src/sql.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `GET /v1/games?outcome=human_win&model_id=<id>&limit=5`. `outcome` is validated against `human_win|ai_win|draw`; `model_id` is an exact-match string rejected over 64 characters. Both are optional and independent; a bad value is a 400. An unknown `model_id` yields an empty list, not an error.

- [ ] **Step 1: Write the failing tests**

In `stats-worker/src/sql.test.ts`, inside `describe("parseListQuery")`, the existing default test must learn the new fields — it will otherwise fail, which is the point:

```ts
  it("defaults to the newest page", () => {
    const r = q("");
    expect(r).toEqual({
      ok: true,
      query: { limit: DEFAULT_LIMIT, cursor: null, status: null, outcome: null, model_id: null },
    });
  });
```

Then add:

```ts
  it("accepts an outcome and a model id", () => {
    const r = q("outcome=human_win&model_id=b9w10-v0");
    expect(r.ok && r.query.outcome).toBe("human_win");
    expect(r.ok && r.query.model_id).toBe("b9w10-v0");
  });

  it("rejects a bad outcome and an oversized model id", () => {
    expect(q("outcome=human-win").ok).toBe(false);
    expect(q("outcome=won").ok).toBe(false);
    expect(q(`model_id=${"x".repeat(65)}`).ok).toBe(false);
    expect(q("model_id=").ok).toBe(false);
  });
```

And in `describe("read statements")`, two filter cases. The existing `seed()` helper takes an overrides object and a `started_at`; the seeded set is all one model, so add a second model's win:

```ts
  it("filters by outcome and by model, together and separately", () => {
    seed(
      { game_id: "g-other", status: "finished", outcome: "human_win", winner: 0, model_id: "b5w5-v0" },
      "2026-08-13T13:00:00.000Z",
    );
    seed(
      { game_id: "g-win", status: "finished", outcome: "human_win", winner: 0 },
      "2026-08-13T14:00:00.000Z",
    );

    expect(list("outcome=human_win").map((g) => g.game_id)).toEqual(["g-win", "g-other"]);
    expect(list("model_id=b5w5-v0").map((g) => g.game_id)).toEqual(["g-other"]);
    expect(list("outcome=human_win&model_id=b5w5-v0").map((g) => g.game_id)).toEqual(["g-other"]);
    expect(list("outcome=human_win&model_id=nope").map((g) => g.game_id)).toEqual([]);
  });
```

Read `record()` in that test file first and confirm it lets an override set `model_id`, and what it defaults that field to. If the default is not what the assertions above assume, adjust the assertions to the real default rather than changing `record()`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix stats-worker run test`
Expected: FAIL — the default-page test reports missing `outcome`/`model_id` keys, and the new tests fail because the parser ignores both parameters.

- [ ] **Step 3: Implement the parsing**

In `stats-worker/src/sql.ts`, beside the existing `STATUSES`:

```ts
const OUTCOMES: readonly string[] = ["human_win", "ai_win", "draw"];

/** Catalogue ids are short slugs like `b9w10-v0`; anything longer is not one. */
const MAX_MODEL_ID = 64;
```

Extend `ListQuery`:

```ts
export interface ListQuery {
  limit: number;
  cursor: ListCursor | null;
  status: GameStatus | null;
  outcome: GameOutcome | null;
  model_id: string | null;
}
```

In `parseListQuery`, after the `status` block and before the `cursor` block:

```ts
  let outcome: GameOutcome | null = null;
  const rawOutcome = params.get("outcome");
  if (rawOutcome !== null) {
    if (!OUTCOMES.includes(rawOutcome)) {
      return { ok: false, error: `outcome must be one of ${OUTCOMES.join("|")}` };
    }
    outcome = rawOutcome as GameOutcome;
  }

  // An exact match, not a search: this filters a list, it does not look a model
  // up, so an id nothing was played with is an empty page rather than a 404.
  let model_id: string | null = null;
  const rawModelId = params.get("model_id");
  if (rawModelId !== null) {
    if (!rawModelId || rawModelId.length > MAX_MODEL_ID) {
      return { ok: false, error: `model_id must be 1 to ${MAX_MODEL_ID} characters` };
    }
    model_id = rawModelId;
  }
```

and return `{ ok: true, query: { limit, cursor, status, outcome, model_id } }`.

In `listStatement`, after the `status` predicate and **before** the cursor predicate:

```ts
  if (q.outcome !== null) {
    where.push("outcome = ?");
    binds.push(q.outcome);
  }
  if (q.model_id !== null) {
    where.push("model_id = ?");
    binds.push(q.model_id);
  }
```

The cursor predicate must stay **last** among the `where` pushes: its binds are positional and the existing pagination tests depend on that order.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix stats-worker run test && npm --prefix stats-worker run typecheck`
Expected: both PASS, no skipped tests.

- [ ] **Step 5: Confirm the worker still bundles**

Run: `CLOUDFLARE_API_TOKEN= npm --prefix stats-worker run deploy:dry`
Expected: resolves the `env.DB`, `env.RATE_LIMIT` and `env.ALLOWED_ORIGINS` bindings and exits with `--dry-run: exiting now.` No credentials involved.

- [ ] **Step 6: Commit**

```bash
cd /workspaces/lll_alpha_quoridor
git add stats-worker/src/
git commit -m "$(cat <<'EOF'
vibe: filter recorded games by outcome and model

The play page wants one narrow question answered -- the last five human
wins against one model -- and today the only way to ask it is to
download the history and sift it in the browser. Two parameters on the
list endpoint turn that into five rows.

Both are optional and independent, and an unknown model id is an empty
page rather than an error: this filters a list, it does not look a
model up.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The reader and the prose

**Files:**
- Modify: `frontend/src/lib/statsApi.ts`
- Create: `frontend/src/lib/hallOfFame.ts`
- Test: `frontend/src/lib/statsApi.test.ts`, `frontend/src/lib/hallOfFame.test.ts`

**Interfaces:**
- Consumes: Task 1's `outcome` and `model_id` parameters.
- Produces:
  - `RECENT_WINS_LIMIT = 5`
  - `recentWinsUrl(endpoint: string, modelId: string, limit: number): string`
  - `fetchRecentWins(endpoint: string, modelId: string, limit: number, fetchImpl: FetchLike): Promise<GameSummary[]>`
  - `winSentence(g: GameSummary): string`
  - `levelPhrase(preset: string): string`

- [ ] **Step 1: Write the failing prose tests**

Create `frontend/src/lib/hallOfFame.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { levelPhrase, winSentence } from "./hallOfFame";
import type { GameSummary } from "./statsApi";

/** A recorded human win. Only the fields the prose reads are meaningful. */
function win(over: Partial<GameSummary> = {}): GameSummary {
  return {
    nick: "Julian",
    human_player: 1,
    preset: "normal",
    move_count: 43,
    started_at: "2026-08-12T18:30:00.000Z",
    ...over,
  } as GameSummary;
}

describe("levelPhrase", () => {
  it("names a known level", () => {
    expect(levelPhrase("normal")).toBe("on Normal");
    expect(levelPhrase("difficult")).toBe("on Difficult");
  });

  // Hand-edited parameters, and games recorded before levels existed. Neither
  // is a level, and dropping those games would silently shrink the wall.
  it("says what it can about the levels that are not levels", () => {
    expect(levelPhrase("custom")).toBe("on custom settings");
    expect(levelPhrase("unknown")).toBe("on an unknown level");
    expect(levelPhrase("something-else")).toBe("on an unknown level");
  });
});

describe("winSentence", () => {
  it("reads as a sentence", () => {
    expect(winSentence(win())).toMatch(/^Julian won as P2 on Normal in 43 moves, .+\.$/);
  });

  // human_player is 0-indexed: 0 is the player who moves first.
  it("calls the first player P1", () => {
    expect(winSentence(win({ human_player: 0 }))).toContain("won as P1");
  });

  it("does not say 1 moves", () => {
    expect(winSentence(win({ move_count: 1 }))).toContain("in 1 move,");
  });
});
```

- [ ] **Step 2: Write the failing reader tests**

Append to `frontend/src/lib/statsApi.test.ts`, and add `fetchRecentWins` to that file's existing import from `./statsApi`:

```ts
describe("fetchRecentWins", () => {
  const row = (over: Partial<GameSummary> = {}): GameSummary =>
    ({ game_id: "g-1", outcome: "human_win", model_id: "b9w10-v0", ...over }) as GameSummary;

  it("asks the worker for one model's wins", async () => {
    const urls: string[] = [];
    await fetchRecentWins(ENDPOINT, "b9w10-v0", 5, async (url) => {
      urls.push(url);
      return jsonResponse({ games: [], next_cursor: null });
    });
    const parsed = new URL(urls[0]);
    expect(parsed.searchParams.get("limit")).toBe("5");
    expect(parsed.searchParams.get("outcome")).toBe("human_win");
    expect(parsed.searchParams.get("model_id")).toBe("b9w10-v0");
  });

  // A worker whose deploy is still waiting for an approval click does not know
  // these parameters, and answers by ignoring them -- which would put other
  // people's losses against other models on the wall as human victories.
  it("drops rows an old worker returned unfiltered", async () => {
    const games = [
      row({ game_id: "keep" }),
      row({ game_id: "wrong-outcome", outcome: "ai_win" }),
      row({ game_id: "wrong-model", model_id: "b5w5-v0" }),
    ];
    const wins = await fetchRecentWins(ENDPOINT, "b9w10-v0", 5, async () =>
      jsonResponse({ games, next_cursor: null }),
    );
    expect(wins.map((g) => g.game_id)).toEqual(["keep"]);
  });

  it("never returns more than asked for", async () => {
    const games = Array.from({ length: 9 }, (_, i) => row({ game_id: `g-${i}` }));
    const wins = await fetchRecentWins(ENDPOINT, "b9w10-v0", 5, async () =>
      jsonResponse({ games, next_cursor: null }),
    );
    expect(wins).toHaveLength(5);
  });

  it("rejects rather than pretending there are no wins", async () => {
    await expect(
      fetchRecentWins(ENDPOINT, "b9w10-v0", 5, async () => jsonResponse({ error: "boom" }, 500)),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npm --prefix frontend run test`
Expected: FAIL — `hallOfFame.ts` does not exist and `fetchRecentWins` is not exported.

- [ ] **Step 4: Implement the reader**

In `frontend/src/lib/statsApi.ts`, after `listUrl`:

```ts
/** How many victories the play page's hall of fame shows. */
export const RECENT_WINS_LIMIT = 5;

export function recentWinsUrl(endpoint: string, modelId: string, limit: number): string {
  const url = new URL(endpoint);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("outcome", "human_win");
  url.searchParams.set("model_id", modelId);
  return url.href;
}

/**
 * The most recent human wins against one model, newest first.
 *
 * Every row is revalidated rather than trusted. A worker that predates these
 * filters ignores parameters it does not know and answers with the newest games
 * of any kind -- and the site can be live against exactly that worker, because
 * a merge publishes the page through Pages immediately while the worker's
 * deploy waits for a reviewer's approval. Filtering here turns a wall of other
 * people's losses into an empty block.
 */
export async function fetchRecentWins(
  endpoint: string,
  modelId: string,
  limit: number,
  fetchImpl: FetchLike,
): Promise<GameSummary[]> {
  const page = asPage(await getJson(recentWinsUrl(endpoint, modelId, limit), fetchImpl));
  return page.games
    .filter((g) => g.outcome === "human_win" && g.model_id === modelId)
    .slice(0, limit);
}
```

- [ ] **Step 5: Implement the prose**

Create `frontend/src/lib/hallOfFame.ts`:

```ts
/**
 * The sentences the play page's hall of fame is made of.
 *
 * Pure, and separate from the component, so the wording is tested without a
 * DOM -- this repo has no component test harness, and prose is the part worth
 * testing anyway.
 */
import { PRESET_LABEL, type Preset } from "./difficulty";
import type { GameSummary } from "./statsApi";

/**
 * How a game's difficulty reads mid-sentence.
 *
 * `custom` means the parameters were hand-edited under Advanced; `unknown`
 * means the game predates levels. Neither is a level, and neither is a reason
 * to leave a real victory off the wall.
 */
export function levelPhrase(preset: string): string {
  if (preset === "custom") return "on custom settings";
  const label = PRESET_LABEL[preset as Preset];
  return label ? `on ${label}` : "on an unknown level";
}

/** One recorded victory, as a sentence. */
export function winSentence(g: GameSummary): string {
  // human_player is 0-indexed, and 0 is the player who moves first.
  const side = g.human_player === 0 ? "P1" : "P2";
  const moves = g.move_count === 1 ? "1 move" : `${g.move_count} moves`;
  const when = new Date(g.started_at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${g.nick} won as ${side} ${levelPhrase(g.preset)} in ${moves}, ${when}.`;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm --prefix frontend run test && npm --prefix frontend exec svelte-check -- --threshold error`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
cd /workspaces/lll_alpha_quoridor
git add frontend/src/lib/statsApi.ts frontend/src/lib/statsApi.test.ts frontend/src/lib/hallOfFame.ts frontend/src/lib/hallOfFame.test.ts
git commit -m "$(cat <<'EOF'
vibe: read one model's recent human wins

The reader revalidates every row instead of trusting the worker to have
filtered it. A merge publishes the page immediately but parks the
worker's deploy waiting for approval, so the new page can be live
against a worker that answers unknown parameters by ignoring them --
which would present other people's losses as human victories.

The sentences live in their own pure module because this repo has no
component test harness, and the wording is the part worth testing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The block on the setup screen

**Files:**
- Create: `frontend/src/lib/HallOfFame.svelte`
- Modify: `frontend/src/lib/SetupScreen.svelte`

**Interfaces:**
- Consumes: `fetchRecentWins`, `RECENT_WINS_LIMIT`, `statsEndpoint` from `./statsApi`; `winSentence` from `./hallOfFame`.
- Produces: `<HallOfFame modelId={...} modelLabel={...} />`, rendered immediately above the `Start game` button.

- [ ] **Step 1: Write the component**

Create `frontend/src/lib/HallOfFame.svelte`:

```svelte
<script lang="ts">
  /**
   * The last few human victories against the selected model.
   *
   * Decoration, and it behaves like it: no spinner, no error message, nothing
   * at all until there is something to say. A player came to this screen to
   * press one button, and a failed request for a wall of names is not worth
   * interrupting that.
   */
  import { RECENT_WINS_LIMIT, fetchRecentWins, statsEndpoint, type GameSummary } from "./statsApi";
  import { winSentence } from "./hallOfFame";

  let { modelId, modelLabel }: { modelId: string; modelLabel: string } = $props();

  // Empty in dev and CI builds, exactly as reporting is disabled there.
  const endpoint = statsEndpoint();

  let wins = $state<GameSummary[] | null>(null);
  let failed = $state(false);

  $effect(() => {
    const id = modelId;
    if (!endpoint) return;
    wins = null;
    failed = false;
    // A slow answer for the model that *was* selected must not land under the
    // heading of the model that is selected now.
    let current = true;
    fetchRecentWins(endpoint, id, RECENT_WINS_LIMIT, (url) => fetch(url))
      .then((rows) => { if (current) wins = rows; })
      .catch(() => { if (current) failed = true; });
    return () => { current = false; };
  });
</script>

{#if endpoint && !failed && wins !== null}
  <section class="hof">
    <h2>Recent human wins against {modelLabel}</h2>
    {#if wins.length === 0}
      <p class="none">Nobody has beaten this model yet — be the first.</p>
    {:else}
      <ul>
        {#each wins as g (g.game_id)}<li>{winSentence(g)}</li>{/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .hof {
    padding: 10px 12px;
    border: 1px solid #e0d3b8;
    border-radius: 8px;
    background: #fdf6e7;
    font-size: 0.85rem;
    color: #6b5a3f;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 0.85rem;
    font-weight: 600;
    color: #3a2412;
  }
  ul { margin: 0; padding-left: 18px; }
  li { margin: 2px 0; line-height: 1.4; }
  .none { margin: 0; }
</style>
```

Nicknames are player-supplied text and go through normal interpolation, which Svelte escapes. There is no `{@html}` in this component and there must not be.

- [ ] **Step 2: Wire it in above Start game**

In `frontend/src/lib/SetupScreen.svelte`, add to the imports at the top of `<script>`:

```ts
  import HallOfFame from "./HallOfFame.svelte";
```

and place the block immediately before the start button, after the `</details>` that closes Advanced:

```svelte
  <HallOfFame modelId={selected.id} modelLabel={selected.label} />

  <button class="start" onclick={onstart} disabled={!named}>Start game</button>
```

- [ ] **Step 3: Type check and test**

Run: `npm --prefix frontend exec svelte-check -- --threshold error && npm --prefix frontend run test`
Expected: both PASS. The component has no unit test — this repo tests modules, not components (`Board.svelte`, `GameList.svelte` and `SetupScreen.svelte` have none), and the browser pass in Task 5 is what covers it.

- [ ] **Step 4: Commit**

```bash
cd /workspaces/lll_alpha_quoridor
git add frontend/src/lib/HallOfFame.svelte frontend/src/lib/SetupScreen.svelte
git commit -m "$(cat <<'EOF'
vibe: show recent human wins above Start game

The setup screen never said that anyone had played this before, or that
the opponent loses sometimes. Every game is already recorded; this puts
a few of those records where a new player will actually see them.

It renders nothing while loading and nothing on failure. A wall of names
is decoration, and decoration does not get to put a spinner or an error
above the button someone came here to press.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The source link

**Files:**
- Create: `frontend/src/lib/SiteFooter.svelte`
- Modify: `frontend/src/App.svelte`, `frontend/src/StatsApp.svelte`

**Interfaces:**
- Consumes: nothing.
- Produces: `<SiteFooter />`, rendered last on both pages.

- [ ] **Step 1: Write the footer**

Create `frontend/src/lib/SiteFooter.svelte`:

```svelte
<script lang="ts">
  /** Shared by the play page and the stats page, so the link cannot drift. */
  const REPO_URL = "https://github.com/adamantivm/lll_alpha_quoridor";
</script>

<footer>
  Open source — <a href={REPO_URL} target="_blank" rel="noopener noreferrer">read the code on GitHub</a>.
</footer>

<style>
  footer {
    margin-top: 24px;
    padding-top: 10px;
    border-top: 1px solid #e0d3b8;
    font-size: 0.8rem;
    color: #6b5a3f;
  }
  a { color: #b45309; }
</style>
```

- [ ] **Step 2: Render it on both pages**

In `frontend/src/App.svelte`, import it beside the other `./lib/` imports:

```ts
  import SiteFooter from "./lib/SiteFooter.svelte";
```

and render it after the `<RulesDialog ... />` element, before the `<style>` block:

```svelte
<SiteFooter />
```

Placing it outside the `{#if !started}` branch is deliberate: it is present during a game too, below the board.

In `frontend/src/StatsApp.svelte`, add the same import beside its existing `./lib/` imports, and render `<SiteFooter />` as the last element of the markup, after the closing `{/if}` of the endpoint/loading/error/games chain and before the `<style>` block.

- [ ] **Step 3: Type check and test**

Run: `npm --prefix frontend exec svelte-check -- --threshold error && npm --prefix frontend run test`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
cd /workspaces/lll_alpha_quoridor
git add frontend/src/lib/SiteFooter.svelte frontend/src/App.svelte frontend/src/StatsApp.svelte
git commit -m "$(cat <<'EOF'
vibe: link to the source from both pages

Someone who wonders how the network plays has nowhere to go from here.
One footer, shared by both pages so the link cannot drift, and outside
the setup branch so it is there during a game too.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Verify it in a real browser

`svelte-check`, vitest and `check:build` say nothing about whether the page renders. AGENTS.md requires this pass, at the end, against the built site — never the dev server, which does not work in this repo.

**Files:**
- Create: `docs/superpowers/results/images/hall-of-fame/*.png`

**Interfaces:**
- Consumes: everything above.
- Produces: the screenshots the results file references.

- [ ] **Step 1: Capture the "before" shots first**

Before is the current `main`, and it must be captured before the branch's build overwrites `frontend/dist`.

```bash
cd /workspaces/lll_alpha_quoridor
git status --short          # must be clean
git checkout main
mkdir -p docs/superpowers/results/images/hall-of-fame
scripts/serve-frontend.sh --build
```

That stays in the foreground; run it with `run_in_background` and wait for it to print `serving http://localhost:8099/lll_alpha_quoridor/`. Then:

```bash
playwright-cli open "http://localhost:8099/lll_alpha_quoridor/"
playwright-cli screenshot docs/superpowers/results/images/hall-of-fame/before-desktop.png
playwright-cli close
playwright-cli --mobile open "http://localhost:8099/lll_alpha_quoridor/"
playwright-cli eval "({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })"
```

The eval must report roughly `360x732` **before** you call the next screenshot mobile — an unknown device name is ignored *in silence* and leaves you on the 1280x720 desktop viewport.

```bash
playwright-cli screenshot docs/superpowers/results/images/hall-of-fame/before-mobile.png
playwright-cli close
```

Stop the server, then `git checkout vibe/hall-of-fame`. The screenshots are untracked so they survive the branch switch.

- [ ] **Step 2: Stand up a stats endpoint the built site can actually read**

`VITE_STATS_ENDPOINT` is empty in dev builds, so the block would render nothing and the browser pass would prove nothing. Serve canned games with CORS headers — a plain `python3 -m http.server` will not do, because the page fetches cross-origin.

```bash
mkdir -p /tmp/claude-1000/-workspaces-lll-alpha-quoridor/hof-mock
cat > /tmp/claude-1000/-workspaces-lll-alpha-quoridor/hof-mock/server.mjs <<'EOF'
import { createServer } from "node:http";

// One game per shape the prose has to handle: both sides, a custom preset, a
// legacy preset of "unknown", a one-move game, and a nickname long enough to
// try to push the card past a phone viewport.
const GAMES = [
  { game_id: "a", nick: "Julian",  human_player: 1, preset: "normal",    move_count: 43, started_at: "2026-08-12T18:30:00.000Z", outcome: "human_win", model_id: "MODEL_A" },
  { game_id: "b", nick: "ana",     human_player: 0, preset: "difficult", move_count: 51, started_at: "2026-08-11T09:05:00.000Z", outcome: "human_win", model_id: "MODEL_A" },
  { game_id: "c", nick: "kiko",    human_player: 1, preset: "custom",    move_count: 38, started_at: "2026-08-09T21:40:00.000Z", outcome: "human_win", model_id: "MODEL_A" },
  { game_id: "d", nick: "someone", human_player: 0, preset: "unknown",   move_count:  1, started_at: "2026-08-02T11:00:00.000Z", outcome: "human_win", model_id: "MODEL_A" },
  { game_id: "e", nick: "a-very-long-nickname-indeed", human_player: 1, preset: "easiest", move_count: 120, started_at: "2026-07-30T08:00:00.000Z", outcome: "human_win", model_id: "MODEL_A" },
];

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-type": "application/json",
  };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  if (url.pathname === "/v1/health") { res.writeHead(200, cors); return res.end('{"ok":true,"version":"mock"}'); }
  const model = url.searchParams.get("model_id");
  const outcome = url.searchParams.get("outcome");
  const limit = Number(url.searchParams.get("limit") ?? 5);
  const games = GAMES
    .filter((g) => (model === null || g.model_id === model) && (outcome === null || g.outcome === outcome))
    .slice(0, limit);
  res.writeHead(200, cors);
  res.end(JSON.stringify({ games, next_cursor: null }));
}).listen(8098, () => console.log("mock stats API on http://localhost:8098"));
EOF
```

**Replace `MODEL_A` with a real catalogue id before running it.** Find the ids this build actually ships:

```bash
grep -rn '"id"' frontend/public/models/ 2>/dev/null | head
```

or read `frontend/src/lib/models.ts` to see where the catalogue is loaded from. Use the id of the model the picker selects by default, so the block has data on first paint. Leave the other models absent from the mock on purpose — Step 5 uses that to prove the empty state and the stale-response guard.

Then start it with `run_in_background` and confirm:

```bash
node /tmp/claude-1000/-workspaces-lll-alpha-quoridor/hof-mock/server.mjs
curl -s "http://localhost:8098/v1/games?limit=5&outcome=human_win&model_id=<the-real-id>" | head -c 200
```

Expected: JSON with five games. This mock honours the filters; the "old worker" behaviour is covered by the unit test in Task 2, not here.

- [ ] **Step 3: Build against the mock and serve**

```bash
cd /workspaces/lll_alpha_quoridor
VITE_STATS_ENDPOINT=http://localhost:8098/v1/games npm --prefix frontend run build
npm --prefix frontend run check:build
scripts/serve-frontend.sh
```

`check:build` must pass — it is the static guard against root-absolute asset URLs that only 404 once deployed under a path prefix. Note the build here does **not** need `--build` on the serve script, because the previous command already built.

- [ ] **Step 4: Look at the desktop page, and read the console**

```bash
playwright-cli open "http://localhost:8099/lll_alpha_quoridor/"
playwright-cli screenshot docs/superpowers/results/images/hall-of-fame/after-desktop.png
playwright-cli console error
```

**Open the PNG and actually look at it.** Confirm: the block sits directly above `Start game`, the sentences read as prose, the footer link is at the bottom. `console error` must be empty — a page can look right and still be throwing.

Then measure rather than eyeball:

```bash
playwright-cli eval "(() => {
  const hof = document.querySelector('section.hof') || document.querySelector('section');
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Start game');
  const f = document.querySelector('footer a');
  return {
    hofBottom: hof && hof.getBoundingClientRect().bottom,
    buttonTop: btn && btn.getBoundingClientRect().top,
    heading: hof && hof.querySelector('h2').textContent,
    firstWin: hof && hof.querySelector('li') && hof.querySelector('li').textContent,
    footerHref: f && f.getAttribute('href'),
    footerTarget: f && f.getAttribute('target'),
    footerRel: f && f.getAttribute('rel'),
  };
})()"
```

Expected: `hofBottom` less than `buttonTop` (the block really is above the button, not merely near it), a heading naming the selected model, a first sentence of the form `Julian won as P2 on Normal in 43 moves, 12 Aug 2026.`, and a footer href of `https://github.com/adamantivm/lll_alpha_quoridor` with `target="_blank"` and `rel` containing `noopener`.

- [ ] **Step 5: Confirm switching models changes the block**

This is the behaviour the whole feature turns on, and no unit test covers the wiring.

```bash
playwright-cli eval "(() => { const s = document.querySelector('select'); const before = document.querySelector('section h2').textContent; s.selectedIndex = (s.selectedIndex + 1) % s.options.length; s.dispatchEvent(new Event('change', { bubbles: true })); return { before, picked: s.options[s.selectedIndex].text }; })()"
playwright-cli eval "(() => { const s = document.querySelector('section'); return { heading: s && s.querySelector('h2').textContent, body: s && s.textContent.slice(0, 120) }; })()"
```

Expected: the heading now names the newly selected model, and because the mock has no games for it, the body is the zero-wins line — **not** the previous model's sentences. Stale sentences under a new heading would mean the guard in the `$effect` is not working. Screenshot this state as `after-desktop-empty.png`.

Switch back to the first model and confirm the sentences return.

- [ ] **Step 6: Phone viewport**

```bash
playwright-cli close
playwright-cli --mobile open "http://localhost:8099/lll_alpha_quoridor/"
playwright-cli eval "({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })"
```

Confirm ~360x732 **before** the screenshot. Then:

```bash
playwright-cli screenshot docs/superpowers/results/images/hall-of-fame/after-mobile.png
playwright-cli eval "({ bodyScrollW: document.body.scrollWidth, innerW: innerWidth })"
playwright-cli console error
playwright-cli close
```

`bodyScrollW` must not exceed `innerW` — the long nickname in the mock exists to try to push it over. Open the PNG and look: the card must not overflow, and the sentences must wrap rather than clip.

- [ ] **Step 7: Stop everything and commit the screenshots**

Kill the background mock server and the static server, then:

```bash
cd /workspaces/lll_alpha_quoridor
playwright-cli close 2>/dev/null
ls -la docs/superpowers/results/images/hall-of-fame/
git add docs/superpowers/results/images/hall-of-fame/
git commit -m "$(cat <<'EOF'
vibe: add hall of fame browser screenshots

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

Each shot should be tens of kilobytes. If any is far larger, do not commit it — re-take it at the intended viewport.

- [ ] **Step 8: Write the results file and open the PR**

Write `docs/superpowers/results/2026-08-25-hall-of-fame-results.md`: what was built, the revalidation argument, what the browser pass actually showed (with the measured numbers, not impressions), and the shipping note — that the merge publishes the page through Pages while the worker's deploy parks for approval, so the block ships empty and the approval fills it.

Reference the screenshots by **raw URL pinned to the commit that added them**, because GitHub does not resolve repository-relative image paths in a PR body:

```
https://raw.githubusercontent.com/adamantivm/lll_alpha_quoridor/<sha-of-the-screenshot-commit>/docs/superpowers/results/images/hall-of-fame/after-desktop.png
```

Commit it, push the branch, and open the PR with `gh pr create --body-file` pointing at that results file. Report the URL. **Do not merge.**

---

## Notes for the implementer

**Ordering that matters:** Task 1 before Task 2 (the reader's parameters must exist), Task 2 before Task 3 (the component imports both new modules), and Task 5's "before" screenshots must come from `main` before the branch's build overwrites `frontend/dist`.

**Three things that are easy to get wrong:**
- `human_player === 0` is **P1**. `GameList.svelte` renders `human_player === 1 ? "P1" : "P2"` for a column that means *the AI's side*, not the human's. Do not copy that expression.
- In `listStatement`, the cursor predicate must stay last among the `where` pushes; its binds are positional and the pagination tests depend on the order.
- `npm --prefix <dir> exec` does not change directory — only `npm --prefix <dir> run` does. Use the `run` form for anything that needs `wrangler.toml`.

**This branch already carries two commits** — the design spec and its update for the automated worker deploy. Build on top of them; do not rewrite them.

**After the merge:** the worker's deploy parks waiting for an approval click. Until someone approves it, the block is correctly empty rather than wrong — that is what the client-side revalidation buys, and it is the one behaviour worth checking in production right after shipping.
