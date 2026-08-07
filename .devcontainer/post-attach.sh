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
echo "  ! gh is not authenticated -- run 'gh auth login' before asking an" >&2
echo "    agent to open pull requests." >&2
if [ -e "$GH_CONFIG_DIR" ] && [ ! -w "$GH_CONFIG_DIR" ]; then
  # Docker creates a missing bind source as a root-owned directory, which
  # leaves gh unable to write the token it is about to fetch.
  echo >&2
  echo "    $GH_CONFIG_DIR is not writable, so that login will fail. It is" >&2
  echo "    bind-mounted from the host; create it there (mkdir -p" >&2
  echo "    ~/.config/gh) and rebuild, or authenticate on the host instead." >&2
else
  echo "    The token is written to $GH_CONFIG_DIR, which devcontainer.json" >&2
  echo "    binds from the host, so this is a one-time step rather than once" >&2
  echo "    per rebuild." >&2
fi
echo >&2

exit 0
