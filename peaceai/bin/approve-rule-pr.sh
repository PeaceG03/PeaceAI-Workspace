#!/usr/bin/env bash
# M8: lands an approved-rules list change written by approve-rule.ts. Commits ONLY peaceai/rules/approved.json
# on a fresh peaceai-approve-rule/ branch (message cites every approval comment), pushes it over SSH with the
# Workspace approve-push deploy key (pushes made with the workflow token start no workflows, so the required
# checks would never run), opens a PR, re-pushes the same tree over SSH so `pull_request` checks start, polls
# the head commit's check-runs until the required checks finish, and squash-merges with the same message.
# Never pushes to main: the only push is to refs/heads/peaceai-approve-rule/<...>; main changes only by the
# squash merge after the required checks pass (the key bypasses no protection; see key-proof-approve-push.sh).
# Usage (results-land only): approve-rule-pr.sh <message-file>. Needs GH_TOKEN, GITHUB_REPOSITORY and
# APPROVE_PUSH_KEY. Fails closed, before any commit or push, when the key is missing.
set -euo pipefail
msg="$1"
: "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}"
here="$(cd "$(dirname "$0")" && pwd)"
if [ -z "${APPROVE_PUSH_KEY:-}" ]; then
  echo "APPROVE PUSH KEY MISSING: secret PEACEAI_APPROVE_PUSH_KEY (environment peaceai-approve-push) is not set; nothing pushed, nothing landed" >&2
  exit 3
fi
REQUIRED_CHECKS="${PEACEAI_REQUIRED_CHECKS:-leak-check tamper-proof}"
[ "$(git status --porcelain)" = " M peaceai/rules/approved.json" ] || { echo "only the approved list may change" >&2; exit 1; }
branch="peaceai-approve-rule/$(sha256sum peaceai/rules/approved.json | cut -c1-12)-$(openssl rand -hex 3)"
case "$branch" in peaceai-approve-rule/*) ;; *) echo "approval changes land only through a peaceai-approve-rule/ branch" >&2; exit 1 ;; esac
git checkout -q -b "$branch"
git add peaceai/rules/approved.json
ident=(-c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com")
git "${ident[@]}" commit -q -F "$msg"
[ "$(git diff --name-only HEAD^ HEAD)" = "peaceai/rules/approved.json" ] || { echo "approval commit must change only the approved list" >&2; exit 1; }
remote="git@github.com:${GITHUB_REPOSITORY}.git"
# Tests only: a local bare repository may stand in for GitHub (an absolute path, never another host).
case "${PEACEAI_PUSH_REMOTE_FOR_TESTS:-}" in /*) remote="$PEACEAI_PUSH_REMOTE_FOR_TESTS" ;; "") ;; *) echo "invalid test remote" >&2; exit 1 ;; esac
# The key goes to a 0600 temp file inside with-deploy-key.sh, which deletes it on exit (trap); never echoed.
push() { DEPLOY_KEY="$APPROVE_PUSH_KEY" "$here/with-deploy-key.sh" git push -q "$@" "$remote" "HEAD:refs/heads/$branch"; }
push
url="$(gh pr create --repo "$GITHUB_REPOSITORY" --base main --head "$branch" --title "$(head -n1 "$msg")" --body-file "$msg")"
pr="${url##*/}"
# A PR opened with the workflow token starts no workflow; a new head pushed with the key does (synchronize).
first="$(git rev-parse HEAD)"
sleep 1
git "${ident[@]}" commit -q --amend --no-edit --date=now
[ "$(git diff --name-only HEAD^ HEAD)" = "peaceai/rules/approved.json" ] || { echo "approval commit must change only the approved list" >&2; exit 1; }
[ "$(git rev-parse HEAD^{tree})" = "$(git rev-parse "$first^{tree}")" ] || { echo "re-push must carry the same tree" >&2; exit 1; }
push --force-with-lease="refs/heads/$branch:$first"
unset APPROVE_PUSH_KEY
sha="$(git rev-parse HEAD)"
echo "pr=$pr" >> "${GITHUB_OUTPUT:-/dev/null}"
if ! "$here/await-checks.sh" "$sha" $REQUIRED_CHECKS; then
  echo "required checks did not pass on #$pr ($sha); not merged" >&2
  exit 1
fi
gh pr merge "$pr" --repo "$GITHUB_REPOSITORY" --squash --delete-branch --match-head-commit "$sha" --subject "$(head -n1 "$msg") (#$pr)" --body "$(tail -n +3 "$msg")"
merged="$(gh pr view "$pr" --repo "$GITHUB_REPOSITORY" --json mergeCommit --jq .mergeCommit.oid)"
echo "merge_sha=$merged" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "approved list merged in #$pr"
