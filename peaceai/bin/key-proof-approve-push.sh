#!/usr/bin/env bash
# Key proof for the approve-push deploy key (Auditor condition 1: the key bypasses nothing). Architect runs this
# once, locally, after adding the key to PeaceAI-Workspace (write access) and before or after storing it as the
# peaceai-approve-push secret. The key never enters any workflow except results-land.
#   (e) the key can push a peaceai-approve-rule/ probe branch (deleted again right after);
#   (f) a push of a new commit to main with the key is REJECTED by main's protection;
#   (g) deleting main with the key is REJECTED.
# Prints PASS/FAIL lines plus a UTC timestamp; paste the output into the PR. Never prints the key.
# Usage: key-proof-approve-push.sh /path/to/private-key
set -uo pipefail
[ -r "${1:-}" ] || { echo "usage: key-proof-approve-push.sh /path/to/private-key" >&2; exit 2; }
here="$(cd "$(dirname "$0")" && pwd)"
repo="git@github.com:PeaceG03/PeaceAI-Workspace.git"
key() { DEPLOY_KEY="$(cat "$1")" "$here/with-deploy-key.sh" "${@:2}"; }
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
fail=0
echo "key-proof approve-push $(date -u +%Y-%m-%dT%H:%M:%SZ)"
key "$1" git clone -q --depth 1 --branch main "$repo" "$work/ws" 2>/dev/null || { echo "FAIL cannot read PeaceAI-Workspace with the key"; exit 1; }
cd "$work/ws"
git -c user.name=PeaceG03 -c user.email=301894882+PeaceG03@users.noreply.github.com commit -q --allow-empty -m "approve-push key proof (must never reach main)"
probe="refs/heads/peaceai-approve-rule/key-proof-$(openssl rand -hex 3)"
if key "$1" git push -q "$repo" "HEAD:$probe" 2>"$work/e.err"; then
  echo "PASS (e) key can push an approval branch"
  key "$1" git push -q "$repo" ":$probe" 2>/dev/null && echo "INFO (e) probe branch deleted" || { echo "FAIL (e) probe branch could NOT be deleted"; fail=1; }
else echo "FAIL (e) key cannot push an approval branch (write access missing?)"; fail=1; fi
if key "$1" git push -q "$repo" "HEAD:refs/heads/main" 2>"$work/f.err"; then
  echo "FAIL (f) !!! PUSH TO main SUCCEEDED WITH THE KEY - it bypasses protection; remove the key now !!!"; fail=1
elif grep -qiE "protected branch|declined|required status|not allowed|denied|rule" "$work/f.err"; then
  echo "PASS (f) push to main rejected: $(grep -iE 'protected branch|declined|required status|not allowed|denied|rule' "$work/f.err" | head -1 | sed 's/^remote: *//')"
else echo "FAIL (f) push to main failed for an unclear reason"; fail=1; fi
if key "$1" git push -q "$repo" ":refs/heads/main" 2>"$work/g.err"; then
  echo "FAIL (g) !!! main WAS DELETED with the key !!!"; fail=1
else echo "PASS (g) deleting main rejected"; fi
exit $fail
