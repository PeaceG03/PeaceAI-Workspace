#!/usr/bin/env bash
# Shallow-clones the private core into the given directory (outside the workspace). Quiet.
set -euo pipefail
dest="$1"
here="$(cd "$(dirname "$0")/../.." && pwd)"
case "$dest" in "$here"/*|"$here") echo "core must be cloned outside the workspace" >&2; exit 1 ;; esac
if ! "$here/peaceai/bin/with-deploy-key.sh" git clone --quiet --depth 1 --no-tags git@github.com:PeaceG03/PeaceAI.git "$dest" >/dev/null 2>&1; then
  echo "core clone failed" >&2
  exit 1
fi
echo "core cloned"
