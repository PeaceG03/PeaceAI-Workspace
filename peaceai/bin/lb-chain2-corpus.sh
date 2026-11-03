#!/usr/bin/env bash
# lb-chain2 v1 (spec peaceai/spec/lb-chain2-v1.md; Auditor #673 binding condition chain2.buildIsolation): builds the
# lb-corpus v2 in the SECRETS-FREE job of peace-lb-chain2.yml. Usage: lb-chain2-corpus.sh <empty work dir> <empty out dir>
# Runs lb-corpus-rebuild.sh (chain-1 out/ + refs/ at b149d9b, anonymous) and then the v2 builder (the unprotected
# lib lbcorpus2 + bin lb-corpus2; m96 exempts exactly this) over this full-history checkout, and copies exactly
# docs.jsonl, manifest.jsonl and fingerprint.json to <out> (the only thing the training job receives; it sha-checks all
# three against the protected pins before use, lb_chain2.py pins).
# It refuses to start (LB_C2_BUILD_HAS_SECRET) when its environment holds anything secret-like: an R2 or deploy key, a
# token, a password or a private key. The workflow job gives it none (no environment, no secrets., contents: read);
# this check is the second line. ACTIONS_RUNTIME_TOKEN (the runner's job-scoped artifact token, not a repository
# secret) is the one name allowed. Logs: shas and counts only.
set -euo pipefail
secret_names() {
  env | cut -d= -f1 | grep -E '(SECRET|PASSWORD|PASSWD|PRIVATE|DEPLOY_KEY|TOKEN|^LM_SAVES_R2_|^AWS_|^R2_|^SSH_AUTH_SOCK$|^GIT_ASKPASS$)' \
    | grep -vx 'ACTIONS_RUNTIME_TOKEN' || true
}
if [ -n "$(secret_names)" ]; then echo "LB_C2_BUILD_HAS_SECRET"; exit 1; fi  # guard:c2-build-no-secret
HERE=$(cd "$(dirname "$0")/../.." && pwd)
W=$(realpath -m "${1:?usage: lb-chain2-corpus.sh <empty work dir> <empty out dir>}")
O=$(realpath -m "${2:?usage: lb-chain2-corpus.sh <empty work dir> <empty out dir>}")
for d in "$W" "$O"; do
  if [ -e "$d" ] && [ -n "$(ls -A "$d")" ]; then echo "LB_C2_BUILD_DIR_NOT_EMPTY"; exit 1; fi
done
test "$(git -C "$HERE" rev-parse --is-shallow-repository)" = false || { echo "LB_C2_BUILD_SHALLOW"; exit 1; }
LB_REBUILD_KEEP_REFS=1 "$HERE/peaceai/bin/lb-corpus-rebuild.sh" "$W"
(cd "$HERE" && ./node_modules/.bin/tsx peaceai/bin/lb-corpus2.ts --repo "$HERE" --base "$W/out" --refs "$W/refs" \
  --exclusions peaceai/model/nl-pairs-exclusions-hidden-hashes.txt --drop-hashes peaceai/model/lb-hidden-drop-hashes.txt \
  --out "$W/v2") > /dev/null
mkdir -p "$O"
for f in docs.jsonl manifest.jsonl fingerprint.json; do cp "$W/v2/$f" "$O/$f"; done
(cd "$O" && sha256sum docs.jsonl manifest.jsonl fingerprint.json)
echo "fingerprint $(jq -r .fingerprint "$O/fingerprint.json")"
rm -rf "$W"
