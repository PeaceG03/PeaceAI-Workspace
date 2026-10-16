#!/usr/bin/env bash
# M8: lands an approved-rules list change written by approve-rule.ts. Commits ONLY peaceai/rules/approved.json
# on a fresh peaceai-approve-rule/ branch (message cites every approval comment), pushes it with the workflow's
# own GITHUB_TOKEN (no deploy key), opens a PR, and starts the required checks by workflow_dispatch on that
# branch (token pushes start no pull_request/push workflows; dispatch is the one trigger the token may use).
# The dispatched jobs report under their exact required names (leak-check, tamper-proof, tests) on the
# branch's head commit. It polls that commit's check-runs until every required check has finished, and
# squash-merges with --match-head-commit only when all of them succeeded. If that merge is refused because the
# PR's own pull_request runs are held for approval, await-held-runs.sh says so on the PR and waits for Peace to
# approve them (never approves, cancels or deletes them itself), then the same merge is retried once.
# Never pushes to main: the only push is to refs/heads/peaceai-approve-rule/<...>; main changes only by the
# squash merge, which branch protection still gates on the required checks.
# Usage (results-land only): approve-rule-pr.sh <message-file>. Needs GH_TOKEN and GITHUB_REPOSITORY.
set -euo pipefail
msg="$1"
: "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}"
here="$(cd "$(dirname "$0")" && pwd)"
REQUIRED_CHECKS="${PEACEAI_REQUIRED_CHECKS:-leak-check tamper-proof tests}"
[ "$(git status --porcelain)" = " M peaceai/rules/approved.json" ] || { echo "only the approved list may change" >&2; exit 1; }
branch="peaceai-approve-rule/$(sha256sum peaceai/rules/approved.json | cut -c1-12)-$(openssl rand -hex 3)"
case "$branch" in peaceai-approve-rule/*) ;; *) echo "approval changes land only through a peaceai-approve-rule/ branch" >&2; exit 1 ;; esac
git checkout -q -b "$branch"
git add peaceai/rules/approved.json
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -F "$msg"
[ "$(git diff --name-only HEAD^ HEAD)" = "peaceai/rules/approved.json" ] || { echo "approval commit must change only the approved list" >&2; exit 1; }
sha="$(git rev-parse HEAD)"
remote="https://github.com/${GITHUB_REPOSITORY}.git"
# Tests only: a local bare repository may stand in for GitHub (an absolute path, never another host).
case "${PEACEAI_PUSH_REMOTE_FOR_TESTS:-}" in /*) remote="$PEACEAI_PUSH_REMOTE_FOR_TESTS" ;; "") ;; *) echo "invalid test remote" >&2; exit 1 ;; esac
auth="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $auth" push -q "$remote" "HEAD:refs/heads/$branch"
url="$(gh pr create --repo "$GITHUB_REPOSITORY" --base main --head "$branch" --title "$(head -n1 "$msg")" --body-file "$msg")"
pr="${url##*/}"
echo "pr=$pr" >> "${GITHUB_OUTPUT:-/dev/null}"
gh workflow run leak-check.yml --repo "$GITHUB_REPOSITORY" --ref "$branch"
gh workflow run ci.yml --repo "$GITHUB_REPOSITORY" --ref "$branch"
if ! "$here/await-checks.sh" "$sha" $REQUIRED_CHECKS; then
  echo "required checks did not pass on #$pr ($sha); not merged" >&2
  exit 1
fi
merge() { gh pr merge "$pr" --repo "$GITHUB_REPOSITORY" --squash --delete-branch --match-head-commit "$sha" --subject "$(head -n1 "$msg") (#$pr)" --body "$(tail -n +3 "$msg")"; }
if ! merge; then
  # #286: a refusal after green required checks is usually pull_request runs held for approval on this head.
  # Make it visible on the PR, wait for a human to approve them, then retry the same exact-head merge once.
  if ! "$here/await-held-runs.sh" "$sha" "$branch" "$pr"; then
    echo "merge refused for #$pr ($sha) even though the dispatched checks passed; not merged" >&2
    exit 1
  fi
  if ! merge; then
    echo "merge refused for #$pr ($sha) after the held runs passed; not merged" >&2
    exit 1
  fi
fi
merged="$(gh pr view "$pr" --repo "$GITHUB_REPOSITORY" --json mergeCommit --jq .mergeCommit.oid)"
echo "merge_sha=$merged" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "approved list merged in #$pr"
