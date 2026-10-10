#!/usr/bin/env bash
# Installs a git pre-push hook in this Workspace clone. Before any push it scans EVERY commit being pushed
# (core text against a local core checkout, plus personal info, secrets and noreply identities) and blocks
# the push on a hit. Usage: install-pre-push.sh [core-dir]   (or set PEACEAI_CORE_DIR).
# The core path is stored only in this clone's .git/hooks; nothing about the core is committed.
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
core="${1:-${PEACEAI_CORE_DIR:-}}"
if [ -z "$core" ]; then echo "usage: install-pre-push.sh <core-dir> (or set PEACEAI_CORE_DIR)" >&2; exit 2; fi
core="$(cd "$core" && pwd)"
git -C "$core" rev-parse --git-dir >/dev/null 2>&1 || { echo "install-pre-push: $core is not a git checkout" >&2; exit 2; }
case "$core" in "$here"|"$here"/*) echo "install-pre-push: core must live outside the workspace" >&2; exit 2 ;; esac
hooks="$(git -C "$here" rev-parse --git-path hooks)"
case "$hooks" in /*) ;; *) hooks="$here/$hooks" ;; esac
mkdir -p "$hooks"
# Snapshot the scanner into .git so the hook does not depend on whichever branch is checked out.
snap="$(git -C "$here" rev-parse --git-path peaceai-prepush)"
case "$snap" in /*) ;; *) snap="$here/$snap" ;; esac
rm -rf "$snap"
mkdir -p "$snap/bin" "$snap/lib"
cp "$here/peaceai/bin/prepush-scan.ts" "$snap/bin/"
for f in coreindex coretext leak; do cp "$here/peaceai/lib/$f.ts" "$snap/lib/"; done
tsx_bin="$here/node_modules/.bin/tsx"
[ -x "$tsx_bin" ] || { echo "install-pre-push: run npm ci first (tsx missing)" >&2; exit 2; }
core_q="$(printf '%q' "$core")"
snap_q="$(printf '%q' "$snap")"
tsx_q="$(printf '%q' "$tsx_bin")"
cat > "$hooks/pre-push" <<HOOK
#!/usr/bin/env bash
# PeaceAI pre-push scan (installed by peaceai/bin/install-pre-push.sh). Blocks the push on any hit.
set -euo pipefail
export PEACEAI_CORE_DIR="\${PEACEAI_CORE_DIR:-$core_q}"
zero="0000000000000000000000000000000000000000"
commits=""
while read -r _lref lsha _rref rsha; do
  [ "\$lsha" = "\$zero" ] && continue   # branch deletion: nothing to scan
  if [ "\$rsha" != "\$zero" ] && git cat-file -e "\$rsha^{commit}" 2>/dev/null; then
    commits="\$commits \$(git rev-list "\$rsha..\$lsha")"
  else
    # New branch (or unknown remote tip): every commit not already on a remote-tracking ref.
    commits="\$commits \$(git rev-list "\$lsha" --not --remotes)"
  fi
done
[ -z "\${commits// /}" ] && { echo "PRE-PUSH PASS commits=0"; exit 0; }
printf '%s\n' "\$commits" | $tsx_q $snap_q/bin/prepush-scan.ts
HOOK
chmod 755 "$hooks/pre-push"
echo "pre-push hook installed (scanner snapshot in .git; re-run after changing the scanner)"
