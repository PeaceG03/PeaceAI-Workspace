#!/usr/bin/env bash
# Installs a git pre-push hook in this Workspace clone. Before any push it scans EVERY commit being pushed
# (core text against a local core checkout, plus personal info, secrets and noreply identities) and blocks
# the push on a hit. Usage: install-pre-push.sh [--template] [core-dir]   (or set PEACEAI_CORE_DIR).
# The core path is stored only in this clone's .git/hooks; nothing about the core is committed.
# --template (M5): also install the hook into this user's git template (init.templateDir), so every NEW
# clone gets it. The template hook only acts when pushing to PeaceAI-Workspace and uses a scanner snapshot
# under ~/.peaceai-prepush.
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
template=false
if [ "${1:-}" = "--template" ]; then template=true; shift; fi
core="${1:-${PEACEAI_CORE_DIR:-}}"
if [ -z "$core" ]; then echo "usage: install-pre-push.sh <core-dir> (or set PEACEAI_CORE_DIR)" >&2; exit 2; fi
core="$(cd "$core" && pwd)"
git -C "$core" rev-parse --git-dir >/dev/null 2>&1 || { echo "install-pre-push: $core is not a git checkout" >&2; exit 2; }
case "$core" in "$here"|"$here"/*) echo "install-pre-push: core must live outside the workspace" >&2; exit 2 ;; esac
if $template; then
  tdir="$(git config --global init.templateDir || true)"
  [ -n "$tdir" ] || { tdir="$HOME/.git-templates"; git config --global init.templateDir "$tdir"; }
  tdir="${tdir/#\~/$HOME}"
  hooks="$tdir/hooks"
  snap="$HOME/.peaceai-prepush"
  # shellcheck disable=SC2016 # expands in the hook, not here
  guard='case "$2" in *[:/]PeaceG03/PeaceAI-Workspace|*[:/]PeaceG03/PeaceAI-Workspace.git) ;; *) exit 0 ;; esac'
else
  hooks="$(git -C "$here" rev-parse --git-path hooks)"
  case "$hooks" in /*) ;; *) hooks="$here/$hooks" ;; esac
  # Snapshot the scanner into .git so the hook does not depend on whichever branch is checked out.
  snap="$(git -C "$here" rev-parse --git-path peaceai-prepush)"
  case "$snap" in /*) ;; *) snap="$here/$snap" ;; esac
  guard=":"
fi
mkdir -p "$hooks"
rm -rf "$snap"
mkdir -p "$snap/bin" "$snap/lib"
cp "$here/peaceai/bin/prepush-scan.ts" "$snap/bin/"
for f in coreindex coretext leak; do cp "$here/peaceai/lib/$f.ts" "$snap/lib/"; done
tsx_bin="$here/node_modules/.bin/tsx"
[ -x "$tsx_bin" ] || { echo "install-pre-push: run npm ci first (tsx missing)" >&2; exit 2; }
if $template; then
  # The template hook must not depend on this clone's node_modules staying put.
  cp -r "$here/node_modules" "$snap/node_modules"
  tsx_bin="$snap/node_modules/.bin/tsx"
fi
core_q="$(printf '%q' "$core")"
snap_q="$(printf '%q' "$snap")"
tsx_q="$(printf '%q' "$tsx_bin")"
cat > "$hooks/pre-push" <<HOOK
#!/usr/bin/env bash
# PeaceAI pre-push scan (installed by peaceai/bin/install-pre-push.sh). Blocks the push on any hit.
set -euo pipefail
$guard
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
if $template; then
  echo "pre-push hook installed in the git template (new clones get it; re-run after changing the scanner)"
else
  echo "pre-push hook installed (scanner snapshot in .git; re-run after changing the scanner)"
fi
