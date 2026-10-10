#!/usr/bin/env bash
# M5: anonymous, read-only clone of a PUBLIC target into <dest> (outside this workspace), optionally at <sha>.
# No token, no credential helper, no prompt: a private repository simply fails to clone (fail closed).
# Usage: clone-target.sh <owner/repo> <dest> [sha]. Quiet; prints no repository content.
set -euo pipefail
target="$1"; dest="$2"; sha="${3:-}"
here="$(cd "$(dirname "$0")/../.." && pwd)"
[[ "$target" =~ ^[A-Za-z0-9-]{1,39}/[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$ ]] || { echo "invalid target" >&2; exit 1; }
[ -z "$sha" ] || [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid sha" >&2; exit 1; }
case "$dest" in "$here"/*|"$here") echo "target must be cloned outside the workspace" >&2; exit 1 ;; esac
anon=(env -u GH_TOKEN -u GITHUB_TOKEN -u DEPLOY_KEY -u GIT_SSH_COMMAND GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false SSH_ASKPASS=/bin/false
  git -c credential.helper= -c core.askPass=/bin/false -c http.extraHeader=)
if ! "${anon[@]}" clone --quiet --no-tags "https://github.com/$target.git" "$dest" >/dev/null 2>&1; then
  echo "target clone failed" >&2
  exit 1
fi
if [ -n "$sha" ]; then
  git -C "$dest" cat-file -e "$sha^{commit}" 2>/dev/null || { echo "target base commit missing" >&2; exit 1; }
  git -C "$dest" -c advice.detachedHead=false checkout --quiet --detach "$sha"
fi
echo "target cloned"
