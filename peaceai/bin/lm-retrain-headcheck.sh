#!/usr/bin/env bash
# M119 (LM retrain): every listed PR's merged content must be the PR head's content, file by file.
#   lm-retrain-headcheck.sh <srcroot>     (anonymous clones from lm-retrain-corpus.sh: <srcroot>/<owner>/<repo>)
# For each "code" line of the commit list: a 2-parent merge must have the head as its second parent; a 1-parent
# (squash or rebase) merge is compared against refs/pull/N/head, fetched from GitHub: that ref must be the listed head,
# and every file the merge commit changes must have the same blob (or be absent in both) at the merge and at the head.
# Fails closed on any difference. Prints counts only.
set -euo pipefail
root="$1"; cfg=peaceai/model/lm-retrain.json; list=$(jq -r .list.file "$cfg")
two=0; one=0; files=0; bad=0
while read -r kind repo num head merge; do
  [ "$kind" = code ] || continue
  n=${num#\#}; h=${head#head=}; m=${merge#merge=}
  [[ "$repo" =~ ^PeaceG03/[A-Za-z0-9._-]+$ && "$n" =~ ^[0-9]+$ && "$h" =~ ^[0-9a-f]{40}$ && "$m" =~ ^[0-9a-f]{40}$ ]] || { echo "bad list line: refused"; exit 1; }
  d="$root/$repo"; read -r -a ps <<< "$(git -C "$d" show -s --format=%P "$m")"
  if [ "${#ps[@]}" = 2 ]; then
    [ "${ps[1]}" = "$h" ] || { echo "$repo#$n: merge's second parent is not the listed head"; bad=$((bad + 1)); }
    two=$((two + 1)); continue
  fi
  [ "${#ps[@]}" = 1 ] || { echo "$repo#$n: merge has ${#ps[@]} parents"; bad=$((bad + 1)); continue; }
  one=$((one + 1))
  git -C "$d" fetch --quiet origin "+refs/pull/$n/head:refs/m119/pull/$n" || { echo "$repo#$n: refs/pull/$n/head could not be fetched: refused"; exit 1; }
  [ "$(git -C "$d" rev-parse "refs/m119/pull/$n")" = "$h" ] || { echo "$repo#$n: refs/pull/$n/head is not the listed head"; bad=$((bad + 1)); continue; }
  changed=$(mktemp); git -C "$d" diff-tree -z --no-commit-id --name-only -r --no-renames "${ps[0]}" "$m" > "$changed" \
    || { rm -f "$changed"; echo "$repo#$n: git diff-tree failed: refused"; exit 1; }
  while IFS= read -r -d '' f; do
    files=$((files + 1))
    a=$(git -C "$d" rev-parse --verify --quiet "$m:$f" || echo absent); b=$(git -C "$d" rev-parse --verify --quiet "$h:$f" || echo absent)
    [ "$a" = "$b" ] || { echo "$repo#$n: a merged file differs from the PR head"; bad=$((bad + 1)); }
  done < "$changed"; rm -f "$changed"
done < "$list"
echo "head check: merges=$two squash_or_rebase=$one files_compared=$files differences=$bad"
[ "$bad" = 0 ] || { echo "merged content is not the PR head content: refused"; exit 1; }
