#!/usr/bin/env bash
# Key proof for the approve-push deploy key (Auditor condition 1: the key bypasses nothing). Runs inside
# results-land (the only job with the key) on a manual dispatch with key_proof=true, which lands nothing; or
# locally with the private key file as $1. The key never enters any other job.
#   (e) the key can push a peaceai-approve-rule/ probe branch (deleted again right after);
#   (f) a push of a new commit to main with the key is REJECTED by main's protection.
# (No delete-main attempt: Auditor's condition on #52.)
# Prints PASS/FAIL lines plus a UTC timestamp; paste the output into the PR. Never prints the key.
# Usage: APPROVE_PUSH_KEY=... key-proof-approve-push.sh   |   key-proof-approve-push.sh /path/to/private-key
set -uo pipefail
if [ -n "${1:-}" ]; then [ -r "$1" ] || { echo "cannot read key file" >&2; exit 2; }; APPROVE_PUSH_KEY="$(cat "$1")"; fi
[ -n "${APPROVE_PUSH_KEY:-}" ] || { echo "APPROVE PUSH KEY MISSING: no key given; nothing tried" >&2; exit 3; }
here="$(cd "$(dirname "$0")" && pwd)"
repo="git@github.com:PeaceG03/PeaceAI-Workspace.git"
key() { DEPLOY_KEY="$APPROVE_PUSH_KEY" "$here/with-deploy-key.sh" "$@"; }
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
fail=0
echo "key-proof approve-push $(date -u +%Y-%m-%dT%H:%M:%SZ)"
key git clone -q --depth 1 --branch main "$repo" "$work/ws" 2>/dev/null || { echo "FAIL cannot read PeaceAI-Workspace with the key"; exit 1; }
cd "$work/ws"
git -c user.name=PeaceG03 -c user.email=301894882+PeaceG03@users.noreply.github.com commit -q --allow-empty -m "approve-push key proof (must never reach main)"
probe="refs/heads/peaceai-approve-rule/key-proof-$(openssl rand -hex 3)"
if key git push -q "$repo" "HEAD:$probe" 2>"$work/e.err"; then
  echo "PASS (e) key can push an approval branch"
  key git push -q "$repo" ":$probe" 2>/dev/null && echo "INFO (e) probe branch deleted" || { echo "FAIL (e) probe branch could NOT be deleted"; fail=1; }
else echo "FAIL (e) key cannot push an approval branch (write access missing?)"; fail=1; fi
if key git push -q "$repo" "HEAD:refs/heads/main" 2>"$work/f.err"; then
  echo "FAIL (f) !!! PUSH TO main SUCCEEDED WITH THE KEY - it bypasses protection; remove the key now !!!"; fail=1
elif grep -qiE "protected branch|declined|required status|not allowed|denied|rule" "$work/f.err"; then
  echo "PASS (f) push to main rejected: $(grep -iE 'protected branch|declined|required status|not allowed|denied|rule' "$work/f.err" | head -1 | sed 's/^remote: *//')"
else echo "FAIL (f) push to main failed for an unclear reason"; fail=1; fi
exit $fail
