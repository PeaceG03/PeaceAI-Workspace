#!/usr/bin/env bash
# Stage exactly the paths a chosen candidate diff touches (after `git apply` in the target clone).
# Replaces `git add -A -- src`, which staged nothing for allowed non-src candidates (tsconfig-script: package.json,
# tsconfig.*.json) and failed the verdict patch build (#307). .github/workflows/** is still refused here as well as
# by the workflow's own pre-apply grep (Auditor #107, change 5). Fails closed if nothing ends up staged.
# Usage: stage-chosen.sh <chosen.diff>   (run inside the target clone)
set -euo pipefail
diff="${1:?usage: stage-chosen.sh <chosen.diff>}"
[ -s "$diff" ] || { echo "refused: empty chosen diff" >&2; exit 1; }
paths=()
while IFS= read -r -d '' rec; do
  # --numstat -z: "added<TAB>deleted<TAB>path"; a rename gives an empty path then old and new as separate NUL fields (both staged).
  p="${rec#*$'\t'}"; p="${p#*$'\t'}"
  [ -n "$p" ] && paths+=("$p")
done < <(git apply --numstat -z "$diff")
[ "${#paths[@]}" -gt 0 ] || { echo "refused: chosen diff names no paths" >&2; exit 1; }
for p in "${paths[@]}"; do
  case "$p" in
    .github/workflows/*) echo "refused: .github/workflows/** goes in only through a normal PR" >&2; exit 1 ;;
    /*|../*|*/../*|..) echo "refused: path outside the repository" >&2; exit 1 ;;
    .git/*|.git) echo "refused: .git path" >&2; exit 1 ;;
  esac
done
git add -A -- "${paths[@]}"
git diff --cached --quiet && { echo "refused: nothing staged from the chosen diff" >&2; exit 1; }
exit 0
