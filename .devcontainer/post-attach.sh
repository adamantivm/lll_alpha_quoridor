#!/usr/bin/env bash
# Runs on every attach to the container (devcontainer.json's postAttachCommand)
# and again at the end of post-create.sh. It only reports the things that need
# a human before an agent can work, so it stays quiet when all is well and
# never exits non-zero -- a failed postAttachCommand is reported as a broken
# container, which would be a wildly disproportionate response to a missing
# token. Deliberately no `set -e` for the same reason.
set -uo pipefail

command -v gh >/dev/null || exit 0

GH_CONFIG_DIR="${GH_CONFIG_DIR:-$HOME/.config/gh}"

if gh auth status >/dev/null 2>&1; then
  exit 0
fi

echo >&2
echo "  ! gh is not authenticated -- fix this before asking an agent to open" >&2
echo "    pull requests." >&2
echo >&2

if [ -e "$GH_CONFIG_DIR" ] && [ ! -w "$GH_CONFIG_DIR" ]; then
  # Docker creates a missing bind source as a root-owned directory, which
  # leaves gh unable to write the token it is about to fetch.
  echo "    $GH_CONFIG_DIR is not writable, so a login will fail. It is" >&2
  echo "    bind-mounted from the host; create it there (mkdir -p" >&2
  echo "    ~/.config/gh) and rebuild the container." >&2
elif [ -s "$GH_CONFIG_DIR/hosts.yml" ] && ! grep -q "oauth_token:" "$GH_CONFIG_DIR/hosts.yml" 2>/dev/null; then
  # hosts.yml names an account but carries no token: the host logged in with
  # gh's default secure storage, which keeps the token in a system keyring
  # that no bind mount can reach. Only the account metadata came across.
  echo "    hosts.yml has an account but no token, so the host logged in" >&2
  echo "    with gh's default secure storage -- that token lives in the" >&2
  echo "    host keyring and no bind mount can reach it." >&2
  echo >&2
  echo "    Log in from inside this container instead:" >&2
  echo "      gh auth login --hostname github.com --git-protocol ssh --web" >&2
  echo >&2
  echo "    There is no keyring here, so gh writes the token to hosts.yml," >&2
  echo "    which is bind-mounted back to the host and survives rebuilds." >&2
else
  echo "    Log in from inside this container:" >&2
  echo "      gh auth login --hostname github.com --git-protocol ssh --web" >&2
  echo >&2
  echo "    Doing it here rather than on the host matters: there is no" >&2
  echo "    keyring in the container, so gh writes the token to" >&2
  echo "    $GH_CONFIG_DIR/hosts.yml, which is bind-mounted from the host" >&2
  echo "    and so persists across rebuilds." >&2
fi
echo >&2

exit 0
