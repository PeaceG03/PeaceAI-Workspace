#!/usr/bin/env bash
# Key proof (a)(b): core key reads PeaceAI; a push with it is denied. Prints PASS/FAIL lines only.
set -uo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
key="$here/peaceai/bin/with-deploy-key.sh"
core="git@github.com:PeaceG03/PeaceAI.git"
probe="refs/heads/peaceai-deny-probe"
fail=0
if "$key" git ls-remote --heads "$core" >/dev/null 2>&1; then echo "PASS (a) core key can read PeaceAI"; else echo "FAIL (a) core key cannot read PeaceAI"; fail=1; fi

work="$(mktemp -d)"
git -C "$work" init -q
git -C "$work" -c user.name=PeaceG03 -c user.email=301894882+PeaceG03@users.noreply.github.com commit -q --allow-empty -m "deny probe"
err="$work/push.err"
if "$key" git -C "$work" push --quiet "$core" "HEAD:$probe" >/dev/null 2>"$err"; then
  echo "FAIL (b) !!! PUSH TO PeaceAI SUCCEEDED - core key has WRITE access !!!"
  fail=1
  if [ "$probe" = "refs/heads/peaceai-deny-probe" ]; then
    if "$key" git -C "$work" push --quiet "$core" ":$probe" >/dev/null 2>&1; then echo "INFO (b) probe ref deleted"; else echo "FAIL (b) probe ref could NOT be deleted"; fi
  fi
elif [ "$fail" = 0 ] && grep -qiE "read only|read-only|denied|not allowed|403" "$err"; then
  echo "PASS (b) core key push to PeaceAI denied"
else
  echo "FAIL (b) push failed for an unexpected reason (not a clear denial)"
  fail=1
fi
rm -rf "$work"
exit $fail
