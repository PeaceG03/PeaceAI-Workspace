#!/usr/bin/env bash
# Key proof (c)(d): Results key reads and writes Results (temporary branch, then deleted)
# and cannot read PeaceAI. Prints PASS/FAIL lines only.
set -uo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
key="$here/peaceai/bin/with-deploy-key.sh"
results="git@github.com:PeaceG03/PeaceAI-Results.git"
core="git@github.com:PeaceG03/PeaceAI.git"
branch="refs/heads/key-proof"
fail=0
if "$key" git ls-remote --heads "$results" >/dev/null 2>&1; then echo "PASS (c1) results key can read Results"; else echo "FAIL (c1) results key cannot read Results"; fail=1; fi

work="$(mktemp -d)"
git -C "$work" init -q
printf 'key proof\n' > "$work/key-proof.txt"
git -C "$work" add key-proof.txt
git -C "$work" -c user.name=PeaceG03 -c user.email=301894882+PeaceG03@users.noreply.github.com commit -q -m "key proof"
if "$key" git -C "$work" push --quiet "$results" "HEAD:$branch" >/dev/null 2>&1 \
  && "$key" git ls-remote "$results" "$branch" 2>/dev/null | grep -q "$(git -C "$work" rev-parse HEAD)"; then
  echo "PASS (c2) results key can write Results (pushed $branch)"
else
  echo "FAIL (c2) results key could not write Results"; fail=1
fi
if [ -n "$("$key" git ls-remote "$results" "$branch" 2>/dev/null)" ]; then
  if "$key" git -C "$work" push --quiet "$results" ":$branch" >/dev/null 2>&1 && [ -z "$("$key" git ls-remote "$results" "$branch" 2>/dev/null)" ]; then
    echo "PASS (c3) proof branch deleted"
  else
    echo "FAIL (c3) proof branch could not be deleted"; fail=1
  fi
fi
rm -rf "$work"

if "$key" git ls-remote --heads "$core" >/dev/null 2>&1; then echo "FAIL (d) results key CAN read PeaceAI"; fail=1; else echo "PASS (d) results key cannot read PeaceAI"; fi
exit $fail
