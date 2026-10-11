#!/usr/bin/env bash
# Polls a commit's check-runs until every named check has finished. Exit 0 only when the latest run of each
# named check concluded `success`; any other conclusion, a missing check at the deadline, or an API error
# fails closed. Usage: await-checks.sh <sha> <check name>... Needs GH_TOKEN and GITHUB_REPOSITORY.
set -uo pipefail
sha="$1"; shift
[ "$#" -gt 0 ] || { echo "no checks named" >&2; exit 1; }
deadline=$(( $(date +%s) + ${PEACEAI_CHECKS_TIMEOUT:-1500} ))
interval="${PEACEAI_CHECKS_INTERVAL:-20}"
gh_bin="${PEACEAI_GH:-gh}"
while :; do
  runs="$("$gh_bin" api "repos/$GITHUB_REPOSITORY/commits/$sha/check-runs?per_page=100" 2>/dev/null)" || runs=""
  pending=0; failed=0
  for name in "$@"; do
    # Latest run of this check on the commit (highest id).
    state="$(printf '%s' "$runs" | NAME="$name" node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{console.log("missing");return}
      const r=(j.check_runs||[]).filter(c=>c.name===process.env.NAME).sort((a,b)=>b.id-a.id)[0];
      console.log(!r?"missing":r.status!=="completed"?"pending":r.conclusion)})')"
    case "$state" in
      success) ;;
      missing|pending) pending=1 ;;
      *) echo "check $name: $state" >&2; failed=1 ;;
    esac
  done
  [ "$failed" = 1 ] && exit 1
  [ "$pending" = 0 ] && { echo "required checks passed on $sha: $*"; exit 0; }
  [ "$(date +%s)" -ge "$deadline" ] && { echo "required checks missing or unfinished at the deadline on $sha" >&2; exit 1; }
  sleep "$interval"
done
