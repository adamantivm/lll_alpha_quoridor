# Stats worker CI deployment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the Cloudflare stats worker and its D1 schema from GitHub Actions, behind an approval gate that a push to `main` cannot remove.

**Architecture:** The Cloudflare API token is a secret of a protected GitHub *environment*, not of the repository, so the only jobs that can read it are the ones whose `environment:` declaration turns on the approval gate. The workflow exposes four rungs — test/dry-run without a token, `whoami`, `versions upload`, and a gated `deploy` — climbed in that order at commissioning. `schema.sql` becomes a wrangler D1 migration so the schema deploys with the code, and the deployed commit sha is compiled into `/v1/health` so the smoke test proves what is actually live.

**Tech Stack:** Cloudflare Workers, wrangler 4.123, D1 (SQLite), GitHub Actions, Node 22, vitest, TypeScript.

Design: `docs/superpowers/specs/2026-08-24-worker-deploy-design.md`

## Global Constraints

- Node **22** in every worker job — `sql.test.ts` needs `node:sqlite` and silently skips itself on older runtimes.
- Cloudflare account id: `d009a181b2d418a62c3365eaa5348a16`. Committed. Not a credential.
- D1 database name `quoridor-stats`, id `126a44cf-fabf-42b1-b288-b6f8db340d65`.
- Worker name `quoridor-stats`. Environment name `stats-worker`. Secret name `CLOUDFLARE_API_TOKEN`.
- Required reviewers: `adamantivm` (400240), `alejandromarcu` (10160443), `jonbinney` (1538056).
- **Never use `wrangler deploy --var`.** It deletes every var not passed on the command line unless `--keep-vars` is given, which would drop `ALLOWED_ORIGINS` and break CORS for the whole site. Use `--define`.
- The Cloudflare API token never enters a development session, a file, or a command line. It is pasted into the GitHub UI by the repository owner.
- Commits: `vibe: ` prefix, imperative, subject ≤50 chars after the prefix. Functional and formatting changes in separate commits. Branch `vibe/worker-deploy`, PR against `main`, never commit to `main`.

---

### Task 1: Turn the schema into a D1 migration

The schema is applied today by hand (`wrangler d1 execute --remote --file schema.sql`). Make it a migration so it travels with the deploy, and adopt the existing database rather than rebuilding it.

**Files:**
- Create: `stats-worker/migrations/0001_baseline.sql` (git mv of `stats-worker/schema.sql`)
- Delete: `stats-worker/schema.sql`
- Modify: `stats-worker/src/sql.test.ts:48`
- Modify: `stats-worker/wrangler.toml`
- Modify: `stats-worker/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `stats-worker/migrations/0001_baseline.sql` — the single source of truth for the `game` table. Task 3's schema check parses column names out of it.

- [ ] **Step 1: Move the file and watch the test break**

```bash
cd /workspaces/lll_alpha_quoridor
git mv stats-worker/schema.sql stats-worker/migrations/0001_baseline.sql
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix stats-worker run test`
Expected: FAIL — `sql.test.ts` throws `ENOENT` on `../schema.sql`. This is the point of moving before editing: it proves the test really reads the file that gets applied to D1, rather than a copy of it.

- [ ] **Step 3: Point the test at the migration**

In `stats-worker/src/sql.test.ts`, line 48:

```ts
const schema = readFileSync(
  fileURLToPath(new URL("../migrations/0001_baseline.sql", import.meta.url)),
  "utf8",
);
```

And in the file's header comment (line 3), `schema.sql` becomes `migrations/0001_baseline.sql`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix stats-worker run test`
Expected: PASS. The same statements, against the same DDL, from its new home.

- [ ] **Step 5: Tell wrangler where the migrations and the account are**

In `stats-worker/wrangler.toml`, add `account_id` under `compatibility_date`:

```toml
# Not a credential: it identifies the account, it does not authorise anything,
# and it is in the URL of every page of the Cloudflare dashboard. Committed so
# CI needs no configuration -- a token that can see more than one account
# leaves wrangler unable to choose, and it cannot prompt in a workflow.
account_id = "d009a181b2d418a62c3365eaa5348a16"
```

and `migrations_dir` inside the existing `[[d1_databases]]` block:

```toml
[[d1_databases]]
binding = "DB"
database_name = "quoridor-stats"
# Filled in by `npx wrangler d1 create quoridor-stats` -- see README.md.
database_id = "126a44cf-fabf-42b1-b288-b6f8db340d65"
# Explicit rather than left to wrangler's default: a default that moves would
# take the schema with it.
migrations_dir = "migrations"
```

- [ ] **Step 6: Verify wrangler agrees the migration is pending locally**

Run: `cd stats-worker && ./node_modules/.bin/wrangler d1 migrations list quoridor-stats --local`
Expected: it lists `0001_baseline.sql` as unapplied. If it says the directory is empty, `migrations_dir` is wrong.

- [ ] **Step 7: Verify the dry run still resolves every binding**

Run: `cd stats-worker && CLOUDFLARE_API_TOKEN= ./node_modules/.bin/wrangler deploy --dry-run --outdir /tmp/worker-bundle`
Expected: prints the `env.DB`, `env.RATE_LIMIT` and `env.ALLOWED_ORIGINS` bindings and exits with `--dry-run: exiting now.` No credentials involved — this is the check Task 3 puts in front of every pull request.

- [ ] **Step 8: Rewrite the README's setup section**

In `stats-worker/README.md`, replace the two `wrangler d1 execute ... --file schema.sql` blocks under "One-time setup" with:

````markdown
Copy the printed `database_id` into `wrangler.toml`, then create the table
locally and remotely by applying the migrations:

```bash
npx wrangler d1 migrations apply quoridor-stats --local
```

```bash
npx wrangler d1 migrations apply quoridor-stats --remote
```

The schema lives in `migrations/`, and `migrations/0001_baseline.sql` is the
table as it stands. It is idempotent (`CREATE TABLE IF NOT EXISTS`), so applying
it to a database that already has the table does nothing but record it as
applied — which is how the existing production database was adopted rather than
rebuilt. Schema changes from here on are new numbered files:

```bash
npx wrangler d1 migrations create quoridor-stats "add the thing"
```

CI applies them before deploying the code (see `.github/workflows/stats-worker-deploy.yml`).
Do not hand-write `ALTER TABLE` against the remote database any more: a change
that is not in `migrations/` will be missing from every database created later.
````

Also replace the manual `ALTER TABLE` recipes further down the README (the `nick`
and `preset` lines) with a note that they are now `migrations/0001_baseline.sql`
and that new columns go in new migration files.

- [ ] **Step 9: Commit**

```bash
cd /workspaces/lll_alpha_quoridor
git add stats-worker/
git commit -m "$(cat <<'EOF'
vibe: make the D1 schema a wrangler migration

The schema was applied by hand and recorded only in a README, which is the
half of a deploy that gets forgotten -- and the half whose absence breaks
production silently. schema.sql moves into migrations/ unchanged; it is
already idempotent, so applying it to the live database adopts that
database instead of rebuilding it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Report the deployed commit from /v1/health

Give the smoke test something to assert that does not depend on any feature, so it keeps working for every future deploy.

**Files:**
- Modify: `stats-worker/src/index.ts` (the `Env` block area and the `/v1/health` branch)
- Test: `stats-worker/src/index.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `GET /v1/health` → `{"ok": true, "version": string}`. `version` is the git sha injected at deploy time, or the literal `"dev"` when the worker was built without one. Task 3's smoke test compares it to `github.sha`.

- [ ] **Step 1: Write the failing test**

In `stats-worker/src/index.test.ts`, replace the existing health test:

```ts
  it("answers health checks with the build it is running", async () => {
    const res = await worker.fetch(new Request("https://stats.example/v1/health"), env());
    expect(res.status).toBe(200);
    // No --define in a test build, so the guard in index.ts reports "dev"
    // rather than throwing on an identifier that was never substituted.
    expect(await res.json()).toEqual({ ok: true, version: "dev" });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix stats-worker exec vitest -- run src/index.test.ts -t "answers health checks"`
Expected: FAIL — received `{ ok: true }`, no `version`.

- [ ] **Step 3: Implement the injected version**

In `stats-worker/src/index.ts`, above `export interface Env`:

```ts
/**
 * The commit this Worker was built from, substituted at deploy time by
 * `wrangler deploy --define BUILD_SHA:'"<sha>"'`. `--define` and not `--var`:
 * `wrangler deploy` deletes every var not named on the command line, so a
 * `--var` here would silently drop ALLOWED_ORIGINS and break CORS site-wide.
 *
 * `typeof` rather than a bare read: nothing substitutes the identifier in
 * `wrangler dev` or under vitest, and reading an undeclared global there would
 * throw. esbuild rewrites the whole expression when the define is present.
 */
declare const BUILD_SHA: string | undefined;
const VERSION = typeof BUILD_SHA === "undefined" ? "dev" : BUILD_SHA;
```

and change the health branch inside `fetch`:

```ts
    if (req.method === "GET" && url.pathname === "/v1/health") {
      return json(200, { ok: true, version: VERSION }, cors);
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix stats-worker exec vitest -- run src/index.test.ts -t "answers health checks"`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and the type check**

Run: `npm --prefix stats-worker run test && npm --prefix stats-worker run typecheck`
Expected: both PASS.

- [ ] **Step 6: Prove the substitution actually reaches the bundle**

The test proves the fallback. This proves the real path, without a token:

```bash
cd stats-worker
CLOUDFLARE_API_TOKEN= ./node_modules/.bin/wrangler deploy --dry-run \
  --outdir /tmp/worker-sha --define BUILD_SHA:'"abc123"'
grep -c 'abc123' /tmp/worker-sha/index.js
```

Expected: at least `1`. If it prints `0`, the define is not reaching esbuild and the smoke test in Task 3 would compare `"dev"` against a sha forever.

- [ ] **Step 7: Commit**

```bash
cd /workspaces/lll_alpha_quoridor
git add stats-worker/src/index.ts stats-worker/src/index.test.ts
git commit -m "$(cat <<'EOF'
vibe: report the deployed commit from /v1/health

A green deploy job says the command exited zero, not that the new code is
what is serving traffic. Compiling the sha into the Worker gives the
post-deploy check something to compare against github.sha, and unlike a
probe for a specific new behaviour it keeps working for every deploy after
this one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The deploy workflow and the schema check

**Files:**
- Create: `.github/workflows/stats-worker-deploy.yml`
- Create: `stats-worker/scripts/check-remote-schema.mjs`
- Modify: `.github/workflows/stats-worker-ci.yml`

**Interfaces:**
- Consumes: `migrations/0001_baseline.sql` (Task 1), `/v1/health` returning `version` (Task 2).
- Produces: the workflow. Its `deploy` job is what Task 5 approves.

- [ ] **Step 1: Write the schema check**

Create `stats-worker/scripts/check-remote-schema.mjs`:

```js
#!/usr/bin/env node
/**
 * Assert that the live D1 table is the table migrations/0001_baseline.sql
 * describes.
 *
 * The baseline is idempotent, which is what lets it adopt the existing
 * production database instead of rebuilding it -- and is also why it would
 * silently accept a live table that differs. Every migration written from here
 * on assumes the baseline is true of the real database, so check it once,
 * before trusting the mechanism, rather than discovering it during an outage.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BASELINE = fileURLToPath(new URL("../migrations/0001_baseline.sql", import.meta.url));
const WRANGLER = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));

/** Column names from the CREATE TABLE body: two spaces, a name, whitespace. */
function baselineColumns(sql) {
  const body = sql.slice(sql.indexOf("CREATE TABLE"));
  const end = body.indexOf("\n);");
  if (end === -1) throw new Error("could not find the end of the CREATE TABLE statement");
  return body
    .slice(0, end)
    .split("\n")
    .map((line) => /^ {2}([a-z_]+)\s/.exec(line))
    .filter((m) => m !== null)
    .map((m) => m[1]);
}

function liveColumns() {
  const out = execFileSync(
    WRANGLER,
    ["d1", "execute", "quoridor-stats", "--remote", "--json", "--command", "PRAGMA table_info(game)"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  // wrangler prints a JSON array of result sets; the rows are in [0].results.
  const parsed = JSON.parse(out.slice(out.indexOf("[")));
  const rows = parsed[0]?.results ?? [];
  return rows.map((r) => r.name);
}

const expected = baselineColumns(readFileSync(BASELINE, "utf8"));
if (expected.length === 0) throw new Error("parsed no columns out of the baseline");
const live = liveColumns();

const missing = expected.filter((c) => !live.includes(c));
const extra = live.filter((c) => !expected.includes(c));

console.log(`baseline: ${expected.length} columns, live: ${live.length} columns`);
if (missing.length === 0 && extra.length === 0) {
  console.log("the live table matches the baseline");
  process.exit(0);
}
if (missing.length) console.error(`missing from the live table: ${missing.join(", ")}`);
if (extra.length) console.error(`present live but not in the baseline: ${extra.join(", ")}`);
console.error(
  "\nThe baseline does not describe the real database. Fix migrations/0001_baseline.sql\n" +
  "to match production before applying any migration against it.",
);
process.exit(1);
```

- [ ] **Step 2: Verify the parser against the real baseline**

The half of that script that needs no token can be checked right now:

```bash
cd stats-worker
node -e "
const {readFileSync}=require('fs');
const sql=readFileSync('migrations/0001_baseline.sql','utf8');
const body=sql.slice(sql.indexOf('CREATE TABLE'));
const cols=body.slice(0,body.indexOf('\n);')).split('\n')
  .map(l=>/^ {2}([a-z_]+)\s/.exec(l)).filter(Boolean).map(m=>m[1]);
console.log(cols.length, cols.join(','));
"
```

Expected: `31` columns, starting `game_id,started_at,updated_at,status,outcome,winner,moves,move_count,...` and ending `...,ip,user_agent,country`. If it prints 0, the regex does not match the file's indentation and the check would pass vacuously — that is why the script also throws on an empty parse.

- [ ] **Step 3: Add the wiring script to package.json**

In `stats-worker/package.json`, add to `scripts`:

```json
    "deploy:dry": "wrangler deploy --dry-run --outdir dist-dry",
    "check:remote-schema": "node scripts/check-remote-schema.mjs",
```

- [ ] **Step 4: Write the deploy workflow**

Create `.github/workflows/stats-worker-deploy.yml`:

```yaml
name: Deploy stats worker

# The Cloudflare API token is a secret of the `stats-worker` environment, not of
# the repository. That is deliberate: a repository secret plus a required
# reviewer would be bypassed by deleting the `environment:` line from this file,
# which anyone who can push to main can do. An environment secret is only
# readable by a job that declares the environment -- and declaring it is what
# turns the approval gate on. Removing the line to skip the gate removes the
# credential with it.
on:
  push:
    branches: [main]
    paths:
      - 'stats-worker/**'
      - '.github/workflows/stats-worker-deploy.yml'
  workflow_dispatch:
    inputs:
      mode:
        description: 'Which rung to run against Cloudflare'
        type: choice
        default: whoami
        options:
          - whoami
          - versions-upload
          - deploy

permissions:
  contents: read

# One at a time, and never cancelled midway: interrupting a deploy is worse
# than letting it finish and having the next run supersede it.
concurrency:
  group: stats-worker-deploy
  cancel-in-progress: false

env:
  WRANGLER_SEND_METRICS: 'false'

jobs:
  check:
    name: Test and dry run
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Node 22, not 20: sql.test.ts exercises the upsert against a real SQLite
      # through node:sqlite and skips itself on older runtimes.
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: stats-worker/package-lock.json
      - run: npm --prefix stats-worker ci
      # Re-run what PR CI ran rather than trusting it: two pull requests that
      # pass separately can still break main together.
      - run: npm --prefix stats-worker run typecheck
      - run: npm --prefix stats-worker run test
      - run: npm --prefix stats-worker run deploy:dry

  verify:
    name: Verify the token and the live schema
    if: github.event_name == 'workflow_dispatch' && inputs.mode == 'whoami'
    needs: check
    runs-on: ubuntu-latest
    environment: stats-worker
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: stats-worker/package-lock.json
      - run: npm --prefix stats-worker ci
      - name: Who this token belongs to, and what it may do
        run: npm --prefix stats-worker exec wrangler -- whoami
      - name: Which migrations the live database has applied
        run: npm --prefix stats-worker exec wrangler -- d1 migrations list quoridor-stats --remote
      - name: The live table matches the baseline
        run: npm --prefix stats-worker run check:remote-schema

  upload:
    name: Upload a version without serving it
    if: github.event_name == 'workflow_dispatch' && inputs.mode == 'versions-upload'
    needs: check
    runs-on: ubuntu-latest
    environment: stats-worker
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: stats-worker/package-lock.json
      - run: npm --prefix stats-worker ci
      # A real upload that takes no traffic, and prints a preview URL. This is
      # the rung that proves the token can write to Cloudflare at all, without
      # anything reaching a player.
      - name: Upload
        run: >
          npm --prefix stats-worker exec wrangler -- versions upload
          --define BUILD_SHA:'"${{ github.sha }}"'

  deploy:
    name: Migrate and deploy
    if: >
      github.ref == 'refs/heads/main' &&
      (github.event_name == 'push' ||
       (github.event_name == 'workflow_dispatch' && inputs.mode == 'deploy'))
    needs: check
    runs-on: ubuntu-latest
    environment: stats-worker
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: stats-worker/package-lock.json
      - run: npm --prefix stats-worker ci

      # Schema first. New code may read a column the old schema lacks; old code
      # tolerates a column it does not know about.
      - name: Apply pending migrations
        run: npm --prefix stats-worker exec wrangler -- d1 migrations apply quoridor-stats --remote -y

      # --define, never --var: `wrangler deploy` deletes every var not named on
      # the command line, so --var BUILD_SHA would drop ALLOWED_ORIGINS and
      # break CORS for the whole site.
      - name: Deploy
        run: >
          npm --prefix stats-worker exec wrangler -- deploy
          --define BUILD_SHA:'"${{ github.sha }}"'

      # A zero exit says the command succeeded, not that the new code is
      # serving. Ask the running Worker which commit it is.
      - name: Smoke test the deployed Worker
        env:
          ENDPOINT: ${{ vars.STATS_ENDPOINT }}
        run: |
          set -euo pipefail
          base="${ENDPOINT%/v1/games}"
          echo "checking ${base}/v1/health"
          body=$(curl -fsS --retry 5 --retry-delay 3 --retry-all-errors "${base}/v1/health")
          echo "$body"
          live=$(printf '%s' "$body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).version??""))')
          if [ "$live" != "${{ github.sha }}" ]; then
            echo "::error::deployed version is '${live}', expected '${{ github.sha }}'"
            exit 1
          fi
          echo "the running Worker is ${live}"
```

- [ ] **Step 5: Add the dry run to pull-request CI**

In `.github/workflows/stats-worker-ci.yml`, after the `Unit tests` step, replace the trailing comment with:

```yaml
      # Needs no credentials at all: it resolves the D1, rate-limit and vars
      # bindings and exits without contacting the API. Cheap insurance that a
      # wrangler.toml edit cannot reach main broken.
      - name: Dry run the deploy
        run: npm --prefix stats-worker run deploy:dry

      # Deployment lives in stats-worker-deploy.yml: it needs the Cloudflare
      # token, which is a secret of the protected `stats-worker` environment.
```

- [ ] **Step 6: Check both workflows are valid YAML with the fields Actions expects**

```bash
cd /workspaces/lll_alpha_quoridor
source .venv/bin/activate   # PyYAML lives here, not in the system python
python - <<'PY'
import yaml, sys
for f in [".github/workflows/stats-worker-deploy.yml", ".github/workflows/stats-worker-ci.yml"]:
    d = yaml.safe_load(open(f))
    # `on:` parses as the boolean True in YAML 1.1 -- that is expected here.
    trig = d.get("on", d.get(True))
    jobs = d["jobs"]
    print(f, "triggers:", sorted(trig), "jobs:", sorted(jobs))
    for name, job in jobs.items():
        assert "runs-on" in job, f"{f}:{name} has no runs-on"
PY
```

Expected: `stats-worker-deploy.yml` lists jobs `check, deploy, upload, verify`, and no assertion fires.

- [ ] **Step 7: Confirm the gate is on every job that reads the secret**

```bash
cd /workspaces/lll_alpha_quoridor
source .venv/bin/activate
python - <<'PY'
import yaml
d = yaml.safe_load(open(".github/workflows/stats-worker-deploy.yml"))
for name, job in d["jobs"].items():
    text = yaml.safe_dump(job)
    uses_secret = "secrets.CLOUDFLARE_API_TOKEN" in text
    gated = job.get("environment") == "stats-worker"
    print(f"{name}: secret={uses_secret} gated={gated}")
    assert uses_secret == gated, f"{name} reads the token without the gate, or vice versa"
print("every job that reads the token declares the environment")
PY
```

Expected: `check: secret=False gated=False`, the other three `True/True`, and the final line. This is the invariant the whole design rests on; assert it rather than eyeball it.

- [ ] **Step 8: Document the arrangement and the way out of it**

Replace the `npx wrangler deploy` block under "One-time setup" in
`stats-worker/README.md` with a `## Deploying` section:

````markdown
## Deploying

CI deploys this Worker. `.github/workflows/stats-worker-deploy.yml` runs on a
push to `main` that touches `stats-worker/`, applies any pending D1 migrations,
deploys, and then asks the running Worker which commit it is serving.

The Cloudflare API token is a secret of the **`stats-worker` environment**, not
of the repository. Only a job that declares `environment: stats-worker` can read
it, and declaring it is what makes the job wait for a reviewer — so deleting the
`environment:` line to skip the approval also deletes the credential. The
environment is additionally pinned to the `main` branch.

Approving a deploy is a separate grant from merging code:

| To let someone… | Give them… |
|---|---|
| merge to `main` | collaborator access with **Write** |
| approve a deploy | a slot in the environment's **Required reviewers** |

Either without the other is fine. On a public repository a reviewer needs only
read access, so the deploy button can be handed out without handing out the code.

`workflow_dispatch` offers two rungs that do not touch production: `whoami`
(checks the token, lists the applied migrations, and verifies the live table
still matches `migrations/0001_baseline.sql`) and `versions-upload` (a real
upload that serves no traffic and prints a preview URL).

### Rollback

```bash
npx wrangler rollback
```

Or pin a specific earlier version:

```bash
npx wrangler versions list
npx wrangler versions deploy <version-id>@100%
```

Neither reverts a migration. D1 migrations only go forward: undoing a schema
change means writing the next migration.
````

- [ ] **Step 9: Commit**

```bash
cd /workspaces/lll_alpha_quoridor
git add .github/workflows/ stats-worker/scripts/ stats-worker/package.json stats-worker/README.md
git commit -m "$(cat <<'EOF'
vibe: deploy the stats worker from CI behind a gate

Four rungs, climbed in order: tests and a credential-free dry run, then
whoami, then a version uploaded without taking traffic, then the gated
deploy. Every job that can reach Cloudflare declares the protected
environment, which is also the only way to read the token -- so removing
the gate removes the credential rather than the approval.

The schema check exists because an idempotent baseline would happily
accept a live table that differs from it, and every future migration is
written against the assumption that it does not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Configure the repository

Done with `gh` by the implementer, not by hand. Everything here is repository configuration; none of it touches the token.

**Files:** none — GitHub API only.

**Interfaces:**
- Consumes: nothing.
- Produces: the `stats-worker` environment the workflow's `environment:` lines refer to. **Must exist before the PR merges**, or the deploy job errors on an unknown environment instead of parking for approval.

- [ ] **Step 1: Create the environment with its reviewers**

```bash
gh api -X PUT repos/adamantivm/lll_alpha_quoridor/environments/stats-worker \
  --input - <<'JSON'
{
  "wait_timer": 0,
  "prevent_self_review": false,
  "reviewers": [
    {"type": "User", "id": 400240},
    {"type": "User", "id": 10160443},
    {"type": "User", "id": 1538056}
  ],
  "deployment_branch_policy": {
    "protected_branches": false,
    "custom_branch_policies": true
  }
}
JSON
```

`prevent_self_review` stays false: with these three, turning it on means nobody can ship their own work unless one of the others is around.

- [ ] **Step 2: Restrict the environment to main**

```bash
gh api -X POST repos/adamantivm/lll_alpha_quoridor/environments/stats-worker/deployment-branch-policies \
  -f name='main' -f type='branch'
```

A second lock behind the `if: github.ref == 'refs/heads/main'` in the workflow: even a workflow edited to drop that guard cannot use this environment — and therefore cannot read the token — from any other branch.

- [ ] **Step 3: Verify what was actually created**

```bash
gh api repos/adamantivm/lll_alpha_quoridor/environments/stats-worker \
  --jq '{name, rules: [.protection_rules[] | {type, reviewers: [.reviewers[]?.reviewer.login]}]}'
gh api repos/adamantivm/lll_alpha_quoridor/environments/stats-worker/deployment-branch-policies \
  --jq '.branch_policies[].name'
```

Expected: a `required_reviewers` rule listing `adamantivm`, `alejandromarcu`, `jonbinney`, and a branch policy of exactly `main`.

- [ ] **Step 4: Invite jonbinney as a collaborator**

```bash
gh api -X PUT repos/adamantivm/lll_alpha_quoridor/collaborators/jonbinney -f permission='push'
gh api repos/adamantivm/lll_alpha_quoridor/invitations --jq '.[] | "\(.invitee.login): \(.permissions) (pending)"'
```

The reviewer slot from Step 1 works immediately — a public repository already gives him the read access a reviewer needs. Write access waits for him to accept the invitation, and until he does he can approve a deploy but not merge.

- [ ] **Step 5: Report the state to the user**

No commit — nothing changed in the repository tree. Tell the user, in one short message: the environment exists, who can approve, that the branch policy is `main`, and that `jonbinney` has a pending invitation to accept. Do not start Task 5 in the same message.

---

### Task 5: Commission it, one step at a time

This task is a conversation, not a script. The user is on a phone and asked to be walked through the manual step rather than handed a document. **Give one instruction per message and wait for confirmation before the next.** Do not paste the whole sequence.

**Files:** none.

**Interfaces:**
- Consumes: the merged PR, the environment from Task 4.
- Produces: a deployed worker whose `/v1/health` reports the merged commit.

- [ ] **Step 1: Write the results file, then open the PR**

Write `docs/superpowers/results/2026-08-24-worker-deploy.md` first — it is the PR
body. What was built, why the token is an environment secret rather than a
repository one, the four rungs and what each proves, and the table of what the
user configures by hand. Say explicitly that no browser verification was run and
why: this PR changes CI configuration and a health endpoint, and nothing it
touches can alter a rendered page. Commit it, then:

```bash
cd /workspaces/lll_alpha_quoridor
git push -u origin vibe/worker-deploy
gh pr create --base main --title "vibe: deploy the stats worker from CI" \
  --body-file docs/superpowers/results/2026-08-24-worker-deploy.md
```

Report the URL. Do not merge it — that is the user's call.

- [ ] **Step 2: Walk the user through the token — message one**

Ask them to check the token they were given has the right permissions, before anything depends on it. In the Cloudflare dashboard, **My Profile → API Tokens**, the token needs:

- **Account → Workers Scripts → Edit**
- **Account → D1 → Edit**
- **Account → Account Settings → Read** (this is what `whoami` reads)

Tell them what to do if it does not have them: edit the token's permissions on that same screen, or create a new one from **Create Token → Create Custom Token** with exactly those three. Then stop and wait.

- [ ] **Step 3: Walk the user through the token — message two**

Only after they confirm. The secret goes on the environment, not on the repository — this is the whole point of the design, so say so in one line:

> github.com/adamantivm/lll_alpha_quoridor/settings/environments → `stats-worker` → **Environment secrets** → **Add secret** → name it exactly `CLOUDFLARE_API_TOKEN` → paste the token → Add secret.

Warn them off the tempting wrong door: **Settings → Secrets and variables → Actions** is the repository-wide secret list, and a token there would be readable by any workflow, gate or no gate. Then stop and wait.

- [ ] **Step 4: Merge, then climb rung one**

After they merge the PR, the deploy job parks itself waiting for approval — expected, not a failure. Ask them to run the first rung, which touches nothing:

> Actions → **Deploy stats worker** → **Run workflow** → mode `whoami` → Run.

It will also ask for their approval (every job that reads the token does). Then read the run for them: `wrangler whoami` should name the account `d009a181b2d418a62c3365eaa5348a16` and list the token's permissions, `d1 migrations list` should show `0001_baseline.sql` as unapplied against the remote database, and the schema check should print `the live table matches the baseline`.

If the schema check fails, **stop**: the baseline does not describe production, and applying migrations on top of that assumption is how a database gets corrupted. Fix `migrations/0001_baseline.sql` to match what the check reported, in a new PR.

- [ ] **Step 5: Rung two**

> Actions → **Deploy stats worker** → **Run workflow** → mode `versions-upload` → Run, then approve.

wrangler prints a preview URL for the uploaded version. Curl its health endpoint and show the user the result:

```bash
curl -s '<preview-url>/v1/health'
```

Expected: `{"ok":true,"version":"<the merge commit sha>"}` — the version is live enough to answer, and is taking no production traffic. If it says `"dev"`, the `--define` is not reaching the build and the smoke test would never have caught a bad deploy.

- [ ] **Step 6: Rung three**

Ask them to approve the deploy job that has been parked since the merge (Actions → the run from their merge → **Review deployments** → `stats-worker` → **Approve and deploy**).

Then read the run for them: migrations applied (`0001_baseline.sql` recorded, no schema change — it is idempotent), the deploy succeeded, and the smoke test printed `the running Worker is <sha>`.

- [ ] **Step 7: Confirm from outside CI**

```bash
curl -s 'https://quoridor-stats.amarcu.workers.dev/v1/health'
curl -s 'https://quoridor-stats.amarcu.workers.dev/v1/games?limit=1' | head -c 300
```

Expected: the health endpoint reports the merged sha, and the list endpoint still answers — the same worker, still serving, with the schema untouched.

- [ ] **Step 8: Write the results file**

`docs/superpowers/results/2026-08-24-worker-deploy.md`: what was built, the trust argument for the environment secret, the rungs and what each one proved, and what the user configured by hand. This is the PR body from Step 1, so write it before Step 1 and update it after Step 7 with what the commissioning actually showed.

---

## Notes for the implementer

**Ordering that matters:**

1. Task 4 must run **before** the PR merges — the workflow names an environment that has to exist.
2. Task 1 before Task 3 — the schema check reads `migrations/0001_baseline.sql`.
3. Task 2 before Task 3 — the smoke test reads a `version` field that has to be there.

**Two things that are easy to get wrong and expensive to discover late:**

- `wrangler deploy --var` deletes the vars it is not given. `ALLOWED_ORIGINS` lives in `wrangler.toml` and losing it takes CORS down for the whole play site. Use `--define`.
- A job that reads `secrets.CLOUDFLARE_API_TOKEN` without `environment: stats-worker` will simply get an empty string and fail confusingly. Step 7 of Task 3 asserts the pairing in both directions for exactly this reason.

**Do not** put the Cloudflare API token in a file, a command, an environment variable in this session, or a `gh secret set` call. It goes into the GitHub web UI, by the user, once.
