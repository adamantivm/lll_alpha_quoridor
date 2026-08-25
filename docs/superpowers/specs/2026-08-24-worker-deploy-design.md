# Deploying the stats worker from CI

## Problem

`stats-worker-ci.yml` runs the tests and then stops, with a comment saying so:

> Deployment stays manual (`npx wrangler deploy`): it needs a Cloudflare API
> token, and the worker changes far less often than the site.

That was true when nothing depended on it. It stopped being true: the hall of
fame (see `2026-08-24-hall-of-fame-design.md`) needs two new query parameters on
`GET /v1/games`, and the frontend deploys itself through Pages CI while the
worker waits for someone to run a command on a laptop. The site would ship a
feature that stays blank until an unrelated manual step happens.

A Cloudflare API token now exists for this purpose. Put the deploy in CI, behind
a gate, and prove it works before trusting it.

The schema comes along, for the same reason: `wrangler d1 execute --remote
--command "ALTER TABLE ..."`, typed by hand and recorded only in the README, is
the half of a deploy that would still be manual — and the half that breaks
production silently when it is forgotten.

## Design

### Trust: the token is an environment secret, not a repository secret

The obvious arrangement — a repository secret plus an environment with required
reviewers — does not hold. Anyone who can push to `main` can delete the
`environment:` line from the workflow, and the next push deploys with no
approval. The gate would stop accidents and nothing else.

Storing the token as a **secret of the protected environment** closes it. Only a
job that declares `environment: stats-worker` can read that secret, and
declaring it is what turns the approval gate on. Removing the line to skip the
gate also removes the credential: the job runs and fails without it. Every path
to Cloudflare goes through the click.

The cost is that the read-only rungs — `whoami`, `versions upload` — also
declare the environment and also need a click. Three clicks during commissioning
and a click per deploy afterwards. Worth it.

What this does not cover, stated plainly: a repository admin can reconfigure the
environment, and a collaborator with write access can propose a workflow that
requests a deploy — which still needs a reviewer's approval. The trust boundary
becomes *who is a required reviewer* and *who is an admin*, which is the
boundary that should carry it.

Fork pull requests never receive secrets, environment or repository, so an
outside contributor's PR cannot reach the token.

### Access, as configured

Required reviewers: `adamantivm`, `alejandromarcu` and `jonbinney`. Any one of
them approving is enough. "Prevent self-review" stays **off**: with two reviewers it would mean
neither can ship their own work when the other is away.

`jonbinney` is not a collaborator today, so both grants apply: a Write
invitation, which he has to accept before it does anything, and a reviewer slot,
which takes effect immediately because a public repository already gives him the
read access a reviewer needs.

Granting access is two independent halves — collaborator with Write
to merge, required reviewer to approve — and either can be given without the
other. On a public repository a reviewer needs only read access, which everyone
has, so the approval button can be granted without granting the code.

### The account id is committed, the token is not

`account_id = "d009a181b2d418a62c3365eaa5348a16"` goes into `wrangler.toml`
next to the `database_id` that is already there. Neither is a credential: both identify, neither authorises, and the
account id is visible in every dashboard URL. Committing it removes a
configuration step and one more thing that can be wrong at 11pm.

Without it, a token with access to more than one account leaves wrangler unable
to choose, and it cannot prompt in CI.

### One source of truth for the schema

`schema.sql` becomes `migrations/0001_baseline.sql`, unchanged, and the original
is deleted. Two files describing one table is the failure this change exists to
prevent.

The baseline is already idempotent — `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX
IF NOT EXISTS` — so applying it to the live database does nothing except record
it as applied. That is the intent: adopt the existing database rather than
rebuild it.

`IF NOT EXISTS` also means a live table that does *not* match the baseline would
be silently accepted, and every future migration would then be written against a
fiction. So the verification rung runs `PRAGMA table_info(game)` against the
remote database and compares the columns to the baseline before anything is
trusted. If they differ, commissioning stops there.

`migrations_dir = "migrations"` is set explicitly in `wrangler.toml` rather than
left to the default, because a default that moves takes the schema with it.

### Proving the deploy landed

`wrangler deploy --define BUILD_SHA:'"<sha>"'`, and `/v1/health` answers
`{"ok":true,"version":"<sha>"}`. The post-deploy step compares that field to
`github.sha` and fails the job if they differ.

`--define` and not `--var`: **`wrangler deploy` deletes every var not passed on
the command line** unless `--keep-vars` is given, so `--var BUILD_SHA` would
have dropped `ALLOWED_ORIGINS` and broken CORS for the whole site. `--define` is
a compile-time substitution and does not touch vars.

An earlier idea was to probe `?outcome=bogus` — 400 from the new worker, 200
from the old one, since an old `parseListQuery` ignores parameters it does not
know. It is a good probe for exactly one deploy and useless afterwards, and it
would fail on the first deploy, which precedes the hall of fame. The injected
sha works for every deploy and depends on no feature.

### The workflow

`.github/workflows/stats-worker-deploy.yml`. Triggers: push to `main` filtered
to `stats-worker/**` and the workflow's own file, plus `workflow_dispatch` with
a `mode` choice.

| Job | Runs on | Token | Gated |
|---|---|---|---|
| `check` | every trigger | no | — |
| `verify` | `mode: whoami` | yes | yes |
| `upload` | `mode: versions-upload` | yes | yes |
| `deploy` | push to `main`, or `mode: deploy` | yes | yes |

- `check` re-runs typecheck, unit tests and `deploy --dry-run` rather than
  trusting that PR CI already passed — the same reasoning already written into
  `pages.yml`: two PRs that pass separately can break `main` together.
- `deploy` applies migrations **before** the code. New code may read a column
  the old schema lacks; old code tolerates a column it does not know.
- `if: github.ref == 'refs/heads/main'` on `deploy`, so a manual dispatch from a
  feature branch cannot publish that branch. `pages.yml` learned this already.
- `concurrency: stats-worker-deploy`, `cancel-in-progress: false`.
- `permissions: contents: read`. `WRANGLER_SEND_METRICS: false`.

`deploy --dry-run` is added to `stats-worker-ci.yml` as well, where it needs no
credentials at all and makes every pull request prove the config still compiles.
This was verified locally with an empty `CLOUDFLARE_API_TOKEN`: it resolves the
D1, rate-limit and vars bindings and exits without contacting the API.

### Commissioning

Merging this PR touches `stats-worker/**`, so the workflow fires and the deploy
job parks itself waiting for approval. The rungs are then climbed in order:

1. `mode: whoami` — the token is present and valid, its permissions are printed,
   and the live schema matches the baseline.
2. `mode: versions-upload` — the token can genuinely write to Cloudflare. A real
   upload that takes no traffic, with a preview URL to curl.
3. Approve the parked deploy — migrations, code, smoke test.

The one step that is not automatable is the token itself: it is pasted into the
GitHub UI by the repository owner and never passes through a development
session. That step is walked through interactively, one instruction at a time,
rather than left in a document to be found later. The README keeps a short
record of the arrangement for future reference.

### Rollback

`wrangler rollback`, and `wrangler versions deploy` to pin an older version,
documented in the worker README next to everything else — the emergency exit
written before it is needed rather than during.

## Out of scope

- A ruleset requiring pull requests on `main`. Recommended separately; `main` has
  no protection today. It is a repository policy question, not part of this
  change.
- Preview or staging environments for the worker. One worker, one database.
- Any change to what the worker does. This PR changes how it gets there.
