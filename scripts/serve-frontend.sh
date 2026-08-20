#!/usr/bin/env bash
# Serve the built frontend the way GitHub Pages does: under a path prefix.
#
# The prefix is the point. Root-absolute asset URLs work perfectly at the site
# root and 404 only once deployed under /<repo>/, which is the regression
# frontend/scripts/check-build.mjs exists to catch statically -- this is the
# same check, in a real browser.
#
# Usage:
#   scripts/serve-frontend.sh              # serve the existing build on :8099
#   scripts/serve-frontend.sh --build      # rebuild first, then serve
#   scripts/serve-frontend.sh --port 9000
#
# Prints the URL to open and stays in the foreground; Ctrl-C stops it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="lll_alpha_quoridor"   # matches the repo name, as Pages serves it
PORT=8099
BUILD=0

while [ $# -gt 0 ]; do
  case "$1" in
    --build) BUILD=1; shift ;;
    --port) PORT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ "$BUILD" -eq 1 ]; then
  # wasm first: frontend/package-lock.json resolves quoridor-wasm by relative
  # path against the pkg/ directory this produces.
  wasm-pack build "$REPO_ROOT/rust/quoridor-wasm" --target web --release
  npm --prefix "$REPO_ROOT/frontend" run build
fi

if [ ! -f "$REPO_ROOT/frontend/dist/index.html" ]; then
  echo "error: frontend/dist is not built. Re-run with --build." >&2
  exit 1
fi

# Serve from a staging copy rather than frontend/dist directly, so the prefix
# is a real path segment instead of something the server has to fake.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/$PREFIX"
cp -r "$REPO_ROOT/frontend/dist/." "$STAGE/$PREFIX/"

echo "serving http://localhost:$PORT/$PREFIX/"
echo "  (stats page: http://localhost:$PORT/$PREFIX/stats.html)"
exec python3 -m http.server "$PORT" -d "$STAGE"
