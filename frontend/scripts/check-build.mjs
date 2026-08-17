/**
 * Post-build assertions for the static site. Guards the two regressions that
 * pass every local check and only fail once deployed under a path prefix:
 * root-absolute asset URLs, and copy targets that silently stop matching.
 *
 * Run: npm --prefix frontend run check:build   (after npm run build)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const src = fileURLToPath(new URL("../src/", import.meta.url));
const failures = [];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// 1. No page may reference assets from the site root. Every entry is checked:
//    a second page is exactly where a root-absolute URL goes unnoticed, since
//    the first one still works.
for (const page of ["index.html", "stats.html"]) {
  let html;
  try {
    html = readFileSync(join(dist, page), "utf8");
  } catch {
    failures.push(`dist/${page} is missing -- check build.rollupOptions.input`);
    continue;
  }
  for (const m of html.matchAll(/(src|href)="\/[^/]/g)) {
    failures.push(`dist/${page} has a root-absolute ${m[1]}: ${m[0]}`);
  }
}

// 2. Every model directory's meta.json must be paired with a model.onnx,
//    and vice versa -- a mismatch means a model silently 404s in production
//    while every other check (including this file's own model count) passes.
const distFiles = walk(dist);
const metaIds = new Set(
  distFiles
    .map((p) => /\/models\/([^/]+)\/meta\.json$/.exec(p))
    .filter(Boolean)
    .map((m) => m[1]),
);
const onnxIds = new Set(
  distFiles
    .map((p) => /\/models\/([^/]+)\/model\.onnx$/.exec(p))
    .filter(Boolean)
    .map((m) => m[1]),
);
if (metaIds.size === 0 && onnxIds.size === 0) {
  failures.push("no dist/models/<id>/model.onnx -- the models copy target stopped matching");
}
for (const id of metaIds) {
  if (!onnxIds.has(id)) {
    failures.push(`dist/models/${id}/ has meta.json but no model.onnx -- check the filename`);
  }
}
for (const id of onnxIds) {
  if (!metaIds.has(id)) {
    failures.push(`dist/models/${id}/ has model.onnx but no meta.json -- check the filename`);
  }
}

// 3. Every ORT runtime file the built worker actually asks for must be in
//    dist/ort/. Derived from the emitted bundle rather than hardcoded: which
//    variant onnxruntime's WebGPU entry point requests (asyncify today) has
//    changed between releases, and a guard that hardcodes the name can only
//    confirm the guess, not catch it being wrong.
const assetNames = new Set(
  distFiles.filter((p) => p.includes("/assets/")).map((p) => p.split("/").pop()),
);
const requested = new Set();
for (const chunk of distFiles.filter((p) => /\/assets\/.*\.js$/.test(p))) {
  for (const m of readFileSync(chunk, "utf8").matchAll(/"(ort-wasm[\w.-]*\.(?:wasm|mjs))"/g)) {
    // Names Vite emitted as hashed assets are resolved by URL, not fetched
    // from wasmPaths, so they are not our responsibility to copy.
    if (!assetNames.has(m[1])) requested.add(m[1]);
  }
}
if (requested.size === 0) {
  failures.push(
    "could not determine which ORT runtime files the worker requests -- the " +
      "detection in this script needs updating for this onnxruntime version",
  );
}
const shipped = new Set(
  distFiles.filter((p) => p.includes("/ort/")).map((p) => p.split("/").pop()),
);
for (const name of requested) {
  if (!shipped.has(name)) {
    failures.push(`dist/ort/${name} is missing -- the worker requests it at runtime`);
  }
}
for (const name of shipped) {
  if (!requested.has(name)) {
    failures.push(`dist/ort/${name} is shipped but never requested -- narrow the copy glob`);
  }
}

// 4. Our own source must not hardcode site-root paths. This reads src/ rather
//    than the bundle on purpose: the worker chunk has all of ORT inlined into
//    it, so scanning built output for these strings risks false positives on
//    ORT's own code.
for (const p of walk(src)) {
  const text = readFileSync(p, "utf8");
  for (const lit of ['"/ort/', '"/models/', "`/models/", "`/ort/"]) {
    if (text.includes(lit)) {
      failures.push(`${p.slice(src.length)} hardcodes ${lit} -- use siteBase() from lib/models.ts`);
    }
  }
}

if (failures.length) {
  console.error("check:build FAILED\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log(`check:build OK (${onnxIds.size} model(s) bundled)`);
