#!/usr/bin/env bash
# M167 (model-v1): restore, from Results main, the LM pinned in peaceai/model/model-v1-proposer.json, in the runtime
# layout lm.ts verifyModelDir and infer.py check (memcheck.json next to the files; the model's retrain run rechecks).
#   DEPLOY_KEY=<a Results key> model-v1-fetch.sh <dest>
# Refuses (fail closed) unless the pin is well formed and is judge-v2.json promoted (version, runId, weightsSha256), every
# model file is a regular file, and the weights hash to the pin. Writes <dest>/models/lm/<version>/{config.json,
# tokenizer.json,weights.npz,memcheck.json} and <dest>/runs/lm-retrain/<runId>/memcheck-recheck-*.json (if any); removes
# the clone's .git. The memcheck itself is checked by the scoring step (verifyModelDir). Reads Results only; prints
# one line (no URLs: git's own errors are dropped).
set -euo pipefail
dest="$1"; pin=peaceai/model/model-v1-proposer.json; v2=peaceai/model/judge-v2.json
[ -n "${DEPLOY_KEY:-}" ] || { echo "no Results key: refused (fail closed)"; exit 1; }
p() { jq -r --arg k "$1" '.[$k] // "" | tostring' "$pin"; }
pv=$(p version); run=$(p runId); ws=$(p weightsSha256)
[[ "$pv" =~ ^lm-v1-[0-9a-f]{12}$ ]] || { echo "model-v1 pin: bad version: refused"; exit 1; }
[[ "$run" =~ ^[1-9][0-9]{5,19}$ ]] || { echo "model-v1 pin: bad runId: refused"; exit 1; }
[[ "$ws" =~ ^[0-9a-f]{64}$ ]] || { echo "model-v1 pin: bad weightsSha256: refused"; exit 1; }
[ "$pv" = "lm-v1-${ws:0:12}" ] || { echo "model-v1 pin: weightsSha256 is not the version's: refused"; exit 1; }
for k in version runId weightsSha256; do
  [ "$(p "$k")" = "$(jq -r --arg k "$k" '.promoted[$k] // "" | tostring' "$v2")" ] || { echo "model-v1 pin $k is not judge-v2.json promoted.$k: refused"; exit 1; }
done
[ ! -e "$dest" ] || { echo "destination already exists: refused"; exit 1; }
M="models/lm/$pv"; D="runs/lm-retrain/$run"
./peaceai/bin/with-deploy-key.sh git clone --quiet --depth 1 --filter=blob:none --sparse git@github.com:PeaceG03/PeaceAI-Results.git "$dest" 2>/dev/null || { echo "Results could not be cloned: refused"; exit 1; }
git -C "$dest" sparse-checkout set --no-cone "/$M/config.json" "/$M/tokenizer.json" "/$M/weights.npz" "/$M/memcheck.json" "/$D/memcheck-recheck-*.json"
./peaceai/bin/with-deploy-key.sh git -C "$dest" checkout --quiet 2>/dev/null || { echo "Results checkout failed: refused"; exit 1; }
for f in config.json tokenizer.json weights.npz memcheck.json; do
  [ -f "$dest/$M/$f" ] && [ ! -L "$dest/$M/$f" ] || { echo "$M/$f missing or not a regular file in Results: refused"; exit 1; }
done
test "$(sha256sum "$dest/$M/weights.npz" | cut -c1-64)" = "$ws" || { echo "weights do not hash to the model-v1 pin: refused"; exit 1; }
test "$(jq -r .version "$dest/$M/config.json")" = "$pv" || { echo "config version is not the pin: refused"; exit 1; }
rm -rf "$dest/.git"
echo "model-v1: $pv restored (weights sha256 verified), $(ls "$dest/$D" 2>/dev/null | grep -c '^memcheck-recheck-' || true) recheck file(s)"
