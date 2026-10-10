#!/usr/bin/env bash
# M8: lands an approved-rules list change written by approve-rule.ts. Commits ONLY peaceai/rules/approved.json
# on a fresh branch (message cites every approval comment), opens a PR, runs the required checks (Actions-token
# PRs do not trigger pull_request workflows), waits for them, and squash-merges with the same message.
# Never pushes to main: the only push is to refs/heads/peaceai-approve-rule/<...>; main changes only by the
# squash merge after the required checks pass.
# Usage (inside the workflow): approve-rule-pr.sh <message-file>. Needs GH_TOKEN and GITHUB_REPOSITORY.
set -euo pipefail
msg="$1"
: "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}"
[ "$(git status --porcelain)" = " M peaceai/rules/approved.json" ] || { echo "only the approved list may change" >&2; exit 1; }
branch="peaceai-approve-rule/$(sha256sum peaceai/rules/approved.json | cut -c1-12)-$(openssl rand -hex 3)"
git checkout -q -b "$branch"
git add peaceai/rules/approved.json
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -F "$msg"
[ "$(git diff --name-only HEAD^ HEAD)" = "peaceai/rules/approved.json" ] || { echo "approval commit must change only the approved list" >&2; exit 1; }
case "$branch" in peaceai-approve-rule/*) ;; *) echo "approval changes land only through a peaceai-approve-rule/ branch" >&2; exit 1 ;; esac
auth="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $auth" push -q origin "HEAD:refs/heads/$branch"
url="$(gh pr create --repo "$GITHUB_REPOSITORY" --base main --head "$branch" --title "$(head -n1 "$msg")" --body-file "$msg")"
pr="${url##*/}"
gh workflow run leak-check.yml --repo "$GITHUB_REPOSITORY" --ref "$branch"
gh workflow run ci.yml --repo "$GITHUB_REPOSITORY" --ref "$branch"
sleep "${PEACEAI_CHECKS_SETTLE:-20}"
if ! timeout 1500 gh pr checks "$pr" --repo "$GITHUB_REPOSITORY" --required --watch --interval 20 >/dev/null; then
  echo "required checks did not pass on #$pr; not merged" >&2
  echo "pr=$pr" >> "${GITHUB_OUTPUT:-/dev/null}"
  exit 1
fi
gh pr merge "$pr" --repo "$GITHUB_REPOSITORY" --squash --delete-branch --subject "$(head -n1 "$msg") (#$pr)" --body "$(tail -n +3 "$msg")"
sha="$(gh pr view "$pr" --repo "$GITHUB_REPOSITORY" --json mergeCommit --jq .mergeCommit.oid)"
echo "pr=$pr" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "merge_sha=$sha" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "approved list merged in #$pr"
