#!/usr/bin/env node
/**
 * Assert that the live D1 table's column names match the table
 * migrations/0001_baseline.sql describes. This checks names only -- not
 * types, defaults, nullability, or indexes -- so it catches a column
 * added or dropped by hand, not a column redefined in place.
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
  console.log("the live table's column names match the baseline");
  process.exit(0);
}
if (missing.length) console.error(`missing from the live table: ${missing.join(", ")}`);
if (extra.length) console.error(`present live but not in the baseline: ${extra.join(", ")}`);
console.error(
  "\nThe baseline does not describe the real database. Fix migrations/0001_baseline.sql\n" +
  "to match production before applying any migration against it.",
);
process.exit(1);
