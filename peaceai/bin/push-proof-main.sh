#!/usr/bin/env bash
# Push proof (Auditor condition on the no-key approval route): with the workflow's own GITHUB_TOKEN and
# `contents: write` (exactly what results-land holds), an empty-commit push to main must be REJECTED by main's
# protection. Exit 1 if main accepts it. No delete attempts. Runs inside results-land on a manual dispatch with
# push_proof=true, which lands nothing. Prints PASS/FAIL plus the rejection line; never prints the token.
set -uo pipefail
: "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}"
remote="https://github.com/${GITHUB_REPOSITORY}.git"
case "${PEACEAI_PUSH_REMOTE_FOR_TESTS:-}" in /*) remote="$PEACEAI_PUSH_REMOTE_FOR_TESTS" ;; "") ;; *) echo "invalid test remote" >&2; exit 1 ;; esac
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
auth="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
g() { git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $auth" "$@"; }
echo "push-proof main $(date -u +%Y-%m-%dT%H:%M:%SZ)"
g clone -q --depth 1 --branch main "$remote" "$work/ws" 2>/dev/null || { echo "FAIL cannot read the repository with the token"; exit 1; }
cd "$work/ws"
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q --allow-empty -m "push proof (must never reach main)"
if g push -q "$remote" "HEAD:refs/heads/main" 2>"$work/f.err"; then
  echo "FAIL !!! PUSH TO main SUCCEEDED WITH THE WORKFLOW TOKEN - main is not protected against it !!!"
  exit 1
fi
line="$(grep -iE 'protected branch|declined|required status|not allowed|denied|rule|permission' "$work/f.err" | head -1 | sed 's/^remote: *//')"
if [ -n "$line" ]; then echo "PASS push to main rejected: $line"; exit 0; fi
echo "FAIL push to main failed for an unclear reason (not counted as a rejection)"; exit 1
