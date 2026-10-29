#!/usr/bin/env bash
# LM retrain promoted-model gate pin (Auditor, after promotion 0d86e8c of lm-v1-858573767465): fetch and check, from
# Results, the pinned promoted model's run record and the live pointer models/lm/latest.json.
#   DEPLOY_KEY=<a Results key> lm-retrain-promoted.sh <dest>
# lm-retrain.json promoted = {version, runId, recordSha256, setcBpb}: the model a retrain candidate must beat on set C v2
# (bpb_gate.py, the same eval.minBpbGain margin as against the in-run replay base). It is separate from replayBase, which
# a retrain still restores, starts from, scores in the run and replays the manifest of. Refuses (fail closed) unless:
# latest.json names promoted.version (and, if it binds a record, the pinned one); runs/lm-retrain/<runId>/record.json
# hashes to promoted.recordSha256; the record is that run's PASS record for promoted.version; its candidate set C v2
# bits/byte is promoted.setcBpb, scored on the pinned slice (eval.setcSliceSha256, eval.setcMaxBytes). Writes
# <dest>/promoted.json {version, runId, recordSha256, setcBpb, latestJsonSha256, resultsCommit}. Reads Results only.
set -euo pipefail
dest="$1"; cfg=peaceai/model/lm-retrain.json
[ -n "${DEPLOY_KEY:-}" ] || { echo "no Results key: refused (fail closed)"; exit 1; }
p() { jq -r --arg k "$1" '.promoted[$k] // "" | tostring' "$cfg"; }
pv=$(p version); run=$(p runId); rs=$(p recordSha256); pb=$(p setcBpb)
[[ "$pv" =~ ^lm-v1-[0-9a-f]{12}$ ]] || { echo "promoted pin: bad version: refused"; exit 1; }
[[ "$run" =~ ^[1-9][0-9]{5,19}$ ]] || { echo "promoted pin: bad runId: refused"; exit 1; }
[[ "$rs" =~ ^[0-9a-f]{64}$ ]] || { echo "promoted pin: bad recordSha256: refused"; exit 1; }
[[ "$pb" =~ ^[0-9]+\.[0-9]{1,12}$ ]] || { echo "promoted pin: setcBpb is not a plain decimal string: refused"; exit 1; }
[ "$(jq -r '.promoted.setcBpb | type' "$cfg")" = string ] || { echo "promoted pin: setcBpb must be a string (exact decimal): refused"; exit 1; }
res="$dest/promoted-res"; rm -rf "$res"; mkdir -p "$dest"
./peaceai/bin/with-deploy-key.sh git clone --quiet --depth 1 --filter=blob:none --sparse git@github.com:PeaceG03/PeaceAI-Results.git "$res"
./peaceai/bin/with-deploy-key.sh git -C "$res" sparse-checkout set --no-cone "/models/lm/latest.json" "/runs/lm-retrain/$run/record.json"
./peaceai/bin/with-deploy-key.sh git -C "$res" checkout --quiet
L="$res/models/lm/latest.json"; R="$res/runs/lm-retrain/$run/record.json"
for f in "$L" "$R"; do [ -f "$f" ] && [ ! -L "$f" ] || { echo "promoted pin: ${f#"$res/"} missing or not a regular file in Results: refused"; exit 1; }; done
lv=$(jq -r '.version // "" | tostring' "$L")
[ "$lv" = "$pv" ] || { echo "promoted pin: Results latest.json names $lv but lm-retrain.json promoted.version is $pv: refused (re-pin promoted to the live model, with its record, before retraining)"; exit 1; }
lr=$(jq -r '.recordSha256 // "" | tostring' "$L")
[ -z "$lr" ] || [ "$lr" = "$rs" ] || { echo "promoted pin: latest.json recordSha256 is not promoted.recordSha256: refused"; exit 1; }
[ "$(sha256sum "$R" | cut -c1-64)" = "$rs" ] || { echo "promoted pin: runs/lm-retrain/$run/record.json does not hash to promoted.recordSha256: refused"; exit 1; }
q() { jq -r "$1 | tostring" "$R"; }
[ "$(q .runId)" = "$run" ] || { echo "promoted pin: record runId is not promoted.runId: refused"; exit 1; }
[ "$(q .candidate)" = "$pv" ] || { echo "promoted pin: record candidate is not promoted.version: refused"; exit 1; }
[ "$(q .gate.pass)" = true ] && [ "$(q .gate.result)" = pass ] || { echo "promoted pin: record gate did not pass: refused"; exit 1; }
[ "$(q .setcV2.bitsPerByte.candidate)" = "$pb" ] || { echo "promoted pin: record set C v2 candidate bits/byte is not promoted.setcBpb: refused"; exit 1; }
[ "$(q .setcV2.sliceSha256.candidate)" = "$(jq -r .eval.setcSliceSha256 "$cfg")" ] && [ "$(q .setcV2.maxBytes)" = "$(jq -r .eval.setcMaxBytes "$cfg")" ] || { echo "promoted pin: record set C v2 slice is not the pinned slice: refused"; exit 1; }
jq -n --arg v "$pv" --arg r "$run" --arg s "$rs" --arg b "$pb" --arg l "$(sha256sum "$L" | cut -c1-64)" --arg c "$(git -C "$res" rev-parse HEAD)" \
  '{version: $v, runId: $r, recordSha256: $s, setcBpb: $b, latestJsonSha256: $l, resultsCommit: $c}' > "$dest/promoted.json"
rm -rf "$res"
echo "promoted model $pv pinned: record $rs (run $run), set C v2 $pb; latest.json names it"
