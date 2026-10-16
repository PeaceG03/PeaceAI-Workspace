#!/usr/bin/env bash
# #286 follow-up: an approval PR's merge can be refused because opening the PR also started pull_request runs
# (ci, leak-check, builder-log) that the repo's external-contributor setting holds for approval
# (conclusion action_required). The bot never approves, cancels or deletes them: approving stays a human act and
# the setting is not relaxed. This script only makes the hold visible and waits for it:
#   1. lists the held pull_request runs on the exact head <sha> of <branch>;
#   2. none held -> exit 2 (the refusal has another cause; the caller fails closed);
#   3. otherwise comments once on PR <pr> with the run links, then polls until every one of those runs has been
#      approved and completed. All success -> exit 0 (the caller retries the merge once, still
#      --match-head-commit). Any other conclusion, the deadline, or an API error -> exit 1.
# The required gate is unchanged: the caller already required the dispatched leak-check, tamper-proof and tests
# check-runs on <sha> to succeed before the first merge attempt.
# Usage: await-held-runs.sh <sha> <branch> <pr>. Needs GH_TOKEN and GITHUB_REPOSITORY.
set -uo pipefail
sha="$1"; branch="$2"; pr="$3"
case "$branch" in peaceai-approve-rule/*) ;; *) echo "held-run wait is only for peaceai-approve-rule/ branches" >&2; exit 1 ;; esac
case "$sha" in *[!0-9a-f]*|"") echo "invalid sha" >&2; exit 1 ;; esac
[ "${#sha}" = 40 ] || { echo "invalid sha" >&2; exit 1; }
case "$pr" in *[!0-9]*|"") echo "invalid pr" >&2; exit 1 ;; esac
deadline=$(( $(date +%s) + ${PEACEAI_HELD_TIMEOUT:-1500} ))
interval="${PEACEAI_HELD_INTERVAL:-20}"
gh_bin="${PEACEAI_GH:-gh}"
# Prints "<id> <state> <url>" per pull_request run on this exact head sha and branch; state is held, pending,
# success or the conclusion. Prints ERROR on unreadable output.
runs() {
  "$gh_bin" api "repos/$GITHUB_REPOSITORY/actions/runs?head_sha=$sha&event=pull_request&per_page=100" 2>/dev/null \
  | SHA="$sha" BRANCH="$branch" node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{console.log("ERROR");return}
    for(const r of (j.workflow_runs||[])){
      if(r.head_sha!==process.env.SHA||r.head_branch!==process.env.BRANCH||r.event!=="pull_request")continue;
      const st=r.conclusion==="action_required"?"held":r.status!=="completed"?"pending":r.conclusion;
      console.log(`${r.id} ${st} ${r.html_url||""}`)}})'
}
first="$(runs)"
[ "$first" = "ERROR" ] && { echo "could not list pull_request runs on $sha" >&2; exit 1; }
held="$(printf '%s\n' "$first" | awk '$2=="held"{print $1}')"
[ -n "$held" ] || { echo "no held pull_request runs on $sha; the merge refusal has another cause" >&2; exit 2; }
links="$(printf '%s\n' "$first" | awk '$2=="held"{print "- " $3}')"
"$gh_bin" pr comment "$pr" --repo "$GITHUB_REPOSITORY" --body "$(printf 'The required checks (leak-check, tamper-proof, tests) passed on %s, but the merge is blocked by pull_request runs held for approval:\n%s\n\nPeace: open each run and choose **Approve and run**. The landing job keeps waiting and squash-merges this exact commit once they pass. Nothing else is needed.' "$sha" "$links")" >/dev/null \
  || echo "could not comment on #$pr (continuing to wait)" >&2
echo "waiting for approval of held pull_request runs on #$pr ($sha): $(echo $held)"
while :; do
  now="$(runs)"
  if [ "$now" != "ERROR" ]; then
    waiting=0; bad=0
    for id in $held; do
      st="$(printf '%s\n' "$now" | awk -v id="$id" '$1==id{print $2}')"
      case "$st" in
        success) ;;
        held|pending|"") waiting=1 ;;
        *) echo "held run $id concluded $st" >&2; bad=1 ;;
      esac
    done
    [ "$bad" = 1 ] && exit 1
    [ "$waiting" = 0 ] && { echo "held pull_request runs approved and passed on $sha"; exit 0; }
  fi
  [ "$(date +%s)" -ge "$deadline" ] && { echo "held pull_request runs on #$pr were not approved and passed by the deadline; not merged" >&2; exit 1; }
  sleep "$interval"
done
