# Deploying the stats worker from CI

The stats worker deployed by hand while the frontend deployed by CI, so any
change spanning both shipped half-dark until someone remembered to run a
command. This moves the worker's deployment into GitHub Actions, behind an
approval gate that a push to `main` cannot remove, and brings the D1 schema
along with it.

Design: `docs/superpowers/specs/2026-08-24-worker-deploy-design.md`
Plan: `docs/superpowers/plans/2026-08-24-worker-deploy.md`

## The trust argument

The obvious arrangement — a repository secret plus an environment with required
reviewers — does not hold. Anyone who can push to `main` can delete the
`environment:` line from the workflow, and the next push deploys with no
approval.

So the Cloudflare API token is a secret of the **protected environment**, not of
the repository. Only a job that declares `environment: stats-worker` can read
it, and declaring it is what turns the approval gate on. Removing the line to
skip the gate removes the credential with it: the job runs and fails without it.

A parsing assertion in the workflow's own verification step holds both halves of
that invariant — every job that reads the token declares the environment, and no
job declares the environment without reading the token — so a future edit that
breaks it fails a check rather than quietly widening access.

The token never entered a development session, a file, or a command line. It is
pasted into the GitHub UI by the repository owner, once.

## What landed

**The schema is a migration.** `schema.sql` became
`migrations/0001_baseline.sql`, byte-identical. It was already idempotent, so
applying it to the live database adopts that database rather than rebuilding it.
`schema.sql` is gone — two files describing one table is the failure this change
exists to prevent.

**The Worker reports its own commit.** `wrangler deploy --define BUILD_SHA` and
`GET /v1/health` answering `{"ok":true,"version":"<sha>"}`, so the post-deploy
check compares against `github.sha` instead of trusting a zero exit code.

`--define` and not `--var`: **`wrangler deploy` deletes every var not passed on
the command line** unless `--keep-vars` is given, so `--var BUILD_SHA` would have
dropped `ALLOWED_ORIGINS` and broken CORS for the whole play site.

**Four rungs, climbed in order.** `check` (tests and a credential-free dry run),
`verify` (`whoami`, the applied-migration list, and a check that the live table
still matches the baseline), `upload` (a real upload that takes no traffic and
prints a preview URL), and the gated `deploy` (migrations, then code, then the
smoke test). The three that can reach Cloudflare are gated; `check` is not.

## What the reviews caught

Three defects that no test in this repository could have caught, all of them
originating in the plan rather than the implementation:

**`-y` is not a flag of `wrangler d1 migrations apply`.** It exists on
`d1 execute`, and the plan borrowed it. The pinned wrangler answers
`Unknown argument: y`. Every deploy would have died at the migration step —
after a human had already spent an approval, and before the code deployed.

**`npm --prefix <dir> exec` does not change directory.** Only `npm run` does. All
four wrangler invocations ran from the repository root, where there is no
`wrangler.toml`: `No configuration file found`. This killed `verify`, `upload`
and `deploy` alike — and `whoami`, which needs no config, would have passed
first, so the failure would have looked like a schema problem rather than a
path problem. The invocations now go through `package.json` scripts.

**A merge-parked deploy blocked its own verification.** `concurrency` was
declared at workflow level, and a run waiting on an environment gate holds its
group — so the deploy parked by the merge would have blocked the `whoami`
dispatch the runbook asks for next, and a later dispatch would have cancelled
it. The block now sits on the `deploy` job, which is what its comment always
said.

Also fixed: the smoke test never retried a *version mismatch* (curl does not
retry a `200` carrying the old sha), so a briefly stale edge would have failed
the job red on the first real deploy; the token sat in the environment of
`npm ci`, which runs dependency install scripts; the rollback runbook required a
laptop and credentials when the operator will be on a phone; and the baseline
SQL's own header still instructed the `--remote d1 execute` that the README now
forbids.

## A live demonstration of why the schema check exists

This repository's own local D1 is in the state the check guards against.
`wrangler d1 migrations list --local` reports "No migrations to apply!" while
`PRAGMA table_info(game)` returns 30 columns — `preset` is missing. An
idempotent baseline was recorded as applied against a table that does not match
it, silently.

That is exactly what `check-remote-schema.mjs` exists to catch before the same
thing happens to production, and why the README now says the run parked by a
merge must not be approved until the `whoami` rung has reported a match.

## Verification

- Worker suite: 59/59 passing, no skips (Node 22 — `sql.test.ts` exercises the
  schema against real SQLite through `node:sqlite` and skips itself silently on
  older runtimes, which would have made the run meaningless).
- `tsc --noEmit` clean.
- `wrangler deploy --dry-run` with an empty `CLOUDFLARE_API_TOKEN`, proving the
  pull-request check needs no credentials.
- The `--define` substitution traced into the compiled bundle, through the npm
  script indirection, with a fake sha.
- The workflow parsed and asserted: valid YAML, and the token/environment
  pairing verified in both directions.
- `d1 migrations apply --local` completing unprompted, which is what proved the
  `-y` defect.

**No browser verification was run, and that is deliberate.** AGENTS.md asks for
it whenever a change can alter what a user sees or can do. This branch changes
CI configuration, a D1 migration file, documentation, and one health endpoint
consumed only by a CI smoke test. Nothing here can change a rendered page: the
frontend bundle is untouched, and `/v1/health` is not read by any frontend code.

## Still to do, by hand

The token is the one step that cannot be automated:

1. Confirm the Cloudflare token carries **Workers Scripts: Edit**, **D1: Edit**
   and **Account Settings: Read**.
2. Add it as an **environment** secret named `CLOUDFLARE_API_TOKEN` on the
   `stats-worker` environment — not as a repository secret, which any workflow
   could read.
3. After merging, climb the rungs in order: `whoami`, then `versions-upload`,
   then approve the parked deploy.

## Repository configuration already applied

| | |
|---|---|
| Environment | `stats-worker` |
| Required reviewers | `adamantivm`, `alejandromarcu` |
| `can_admins_bypass` | `false` — the default was `true`, which would have let an admin skip the approval the design promises |
| Branch policy | `main` only |
| `jonbinney` | invited as a collaborator with Write; **the invitation is pending**, and GitHub refuses a pending invitee as a required reviewer, so his reviewer slot has to be added once he accepts |

## Commissioning, as it actually went

Merged as `9d7cdbf`. The four rungs were climbed in order on 2026-08-25.

**`whoami`** — the token is an Account API Token on `Amarcu@gmail.com's Account`,
account id `d009a181b2d418a62c3365eaa5348a16`, matching the value committed to
`wrangler.toml`. `0001_baseline.sql` listed as pending against the remote
database, and the schema check reported `baseline: 31 columns, live: 31 columns`
— the live table's column names match the baseline, `preset` included. This is
what made adopting the existing database safe rather than assumed; had it
differed, commissioning would have stopped there.

**`versions-upload`** — a real upload that took no traffic:

```
preview:    {"ok":true,"version":"9d7cdbf5ae0dfa35b3eef31add5b5ad5ea753a62"}
production: {"ok":true}
```

The preview knew its own commit, proving `--define` survives the npm-script
indirection in real CI; production still answered without a `version` field,
proving nothing had reached a player yet.

**`deploy`** — migrations first (`Executed 4 commands`, the expected no-op that
records the baseline as adopted), then the code, then the smoke test.

### The retry fix earned itself on the first deploy

```
attempt 1/5: live version is '', waiting for '9d7cdbf...'
attempt 2/5: live version is '', waiting for '9d7cdbf...'
the running Worker is 9d7cdbf5ae0dfa35b3eef31add5b5ad5ea753a62
```

The first two attempts hit the *old* Worker — the empty `version` is the old
code, which had no such field. The edge took about ten seconds to propagate.

The original smoke test used `curl --retry`, which retries transport and HTTP
errors but not a `200` carrying the previous version, so it would have failed
red on attempt one. Production would have been perfectly healthy and the report
would have said otherwise, at the exact moment — first deploy, operator on a
phone — when nobody could tell the difference. The whole-branch review flagged
it as hypothetical; it fired immediately.

### Verified from outside CI

```
$ curl -s https://quoridor-stats.amarcu.workers.dev/v1/health
{"ok":true,"version":"9d7cdbf5ae0dfa35b3eef31add5b5ad5ea753a62"}
```

and `GET /v1/games?limit=1` still returns recorded games.

### Outstanding

`jonbinney` has a pending collaborator invitation. GitHub refuses a pending
invitee as a required reviewer, so his approval slot must be added after he
accepts — until then the reviewers are `adamantivm` and `alejandromarcu`.
