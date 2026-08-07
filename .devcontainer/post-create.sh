#!/usr/bin/env bash
# Provisions the toolchain the quoridor work needs. Run by devcontainer.json's
# postCreateCommand, and safe to re-run by hand against a live container.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> claude plugin paths"
# devcontainer.json bind-mounts the host's ~/.claude over /home/vscode/.claude.
# The contents survive that, but Claude Code records absolute installPaths for
# plugins (~/.claude/plugins/installed_plugins.json and known_marketplaces.json),
# and those still name the *host's* home directory, which doesn't exist in here.
# Unresolvable paths make Claude Code skip the plugin entirely and mark its cache
# as orphaned, so installed plugins silently vanish -- no skills, no commands.
# Same class of problem as the venv shebangs further down.
#
# Rewriting those files is not an option: they're the host's own, via the bind
# mount, and container-absolute paths would break the plugins on the host. So
# make the host's path resolve in here instead. Read the prefix back out of the
# metadata rather than hardcoding a username.
CLAUDE_PLUGIN_META="$HOME/.claude/plugins/installed_plugins.json"
if [ -f "$CLAUDE_PLUGIN_META" ]; then
  host_home="$(sed -n 's|.*"installPath": *"\(/home/[^/]*\)/.*|\1|p' \
    "$CLAUDE_PLUGIN_META" | head -n1)"
  if [ -n "$host_home" ] && [ "$host_home" != "$HOME" ] && [ ! -e "$host_home" ]; then
    sudo ln -sfn "$HOME" "$host_home"
    echo "linked $host_home -> $HOME so plugin installPaths resolve"
  fi
fi
# Claude Code stamps .orphaned_at on plugin caches it couldn't resolve and sweeps
# them later. Clear those now that the paths work, or the payload gets deleted.
find "$HOME/.claude/plugins/cache" -maxdepth 4 -name .orphaned_at -delete 2>/dev/null || true

echo "==> apt packages"
sudo apt-get update -qq
# pkg-config and libssl-dev: needed to build openssl-sys, pulled in via
# ort -> ureq -> native-tls when building the rust crate's `binary` feature.
sudo apt-get install -y -qq python3.12 python3.12-venv python3-pip pkg-config libssl-dev

echo "==> rust toolchain"
# devcontainer.json's rust feature is what normally puts rustup here. Install
# it ourselves if it's absent anyway: rust is not optional in this repo (the
# PyO3 crate under rust/, and the wasm build the frontend consumes), so a
# container without it is not a usable environment, and wasm-pack's installer
# fails outright without a toolchain to install into.
# rustup keeps its shims in $CARGO_HOME/bin and communicates that by appending
# to the shell profiles, which a non-interactive `bash post-create.sh` never
# sources. Put the directory on PATH before looking, so a toolchain the rust
# feature or an earlier run already installed is found instead of reinstalled.
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
if ! command -v rustup >/dev/null; then
  curl -sSf https://sh.rustup.rs | sh -s -- -y --profile default
fi

echo "==> wasm-pack"
command -v wasm-pack >/dev/null || \
  curl -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh

# Fail loudly rather than hand back a half-provisioned container: everything
# above is expected to leave all of these on PATH.
for tool in rustup cargo rustc wasm-pack; do
  if ! command -v "$tool" >/dev/null; then
    echo "error: $tool is still missing after provisioning. The rust/ crate" >&2
    echo "  and the frontend's wasm build both need it, so this container is" >&2
    echo "  not usable as-is -- check the install output above." >&2
    exit 1
  fi
done
rustc --version
wasm-pack --version

echo "==> python venv (3.12)"
# This workspace is bind-mounted from the host, so .venv is the host's own
# venv, not something built inside this container -- it is deliberately
# preserved and must never be deleted. Only create it if it's missing (e.g.
# a fresh clone on a machine with no venv yet).
if [ ! -d "$REPO_ROOT/.venv" ]; then
  python3.12 -m venv "$REPO_ROOT/.venv"
fi
# The venv's console scripts (pip, pytest, wandb, ...) carry host-absolute
# shebangs baked in on the host, so they can't execute inside the container
# under the bind mount. That's expected -- warn rather than "fixing" it by
# rewriting shebangs or recreating the venv. "python -m pip" sidesteps the
# problem entirely, since it runs via the venv's real interpreter.
if [ -x "$REPO_ROOT/.venv/bin/pip" ]; then
  pip_shebang="$(head -n1 "$REPO_ROOT/.venv/bin/pip")"
  pip_interpreter="${pip_shebang#"#!"}"
  if [ ! -x "$pip_interpreter" ]; then
    echo "note: $REPO_ROOT/.venv/bin/pip's shebang points at" >&2
    echo "  $pip_interpreter, which doesn't exist in this container --" >&2
    echo "  expected, since that shebang is host-absolute and this" >&2
    echo "  workspace is bind-mounted. Using '.venv/bin/python -m pip'" >&2
    echo "  instead; do the same by hand." >&2
  fi
fi
"$REPO_ROOT/.venv/bin/python" -m pip install --upgrade pip

echo "==> python requirements"
# Full requirements (not ci_requirements) -- the latter pins torch==2.9.1+cpu
# and so cannot support GPU training. maturin is listed there, so it lands in
# the venv rather than needing a separate install.
"$REPO_ROOT/.venv/bin/python" -m pip install -r "$REPO_ROOT/requirements.txt"

echo "==> github cli"
# Authenticating gh can't be automated here -- the login flow is interactive --
# so surface it the same way an attach does, and don't let it fail the build.
"$REPO_ROOT/.devcontainer/post-attach.sh" || true

echo "==> done"
