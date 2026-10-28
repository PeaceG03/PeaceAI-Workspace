#!/usr/bin/env bash
# M125 (reuse the selected sweep arm): the candidate IS the selected arm's checkpoint at the selected step. train.py's
# best.npz at bestStep, exported in the arm job, is what the pre-M125 re-train reproduced (same seed, schedule and data
# order; run 40624227227: same val loss 3.5199) at a cost of ~4 h (14461 s). No key here. Counts only on stdout.
#   lm-retrain-arm-reuse.sh <fetched arms dir> <verified dir> <select.json> <live dir> <model out> <candidate-train out> <metrics out>
# <verified dir> is lm-retrain-arm-verify.sh's output. Writes reused=true|false to $GITHUB_OUTPUT.
#   reused=false (exit 0): the selected arm was not saved (its save failed): finetune-eval-land re-trains the candidate
#     (the pre-M125 path, still bounded by the 15300 s candidate deadline).
#   reused=true: the weights hash (again, here) to the sha256 the verified arm status and save.json bind; the export is at
#     the selected step and lr; the same identity checks as the re-train path (valSplit, replay.val, replay.corpus: jq -cS
#     on both sides; mode) hold; the model dir and <candidate-train out> (the arm summary + stoppedStep = the selected
#     step, armStoppedStep, source) are written.
#   Anything that does not match refuses (exit 1): never a silent fallback on a mismatch.
set -euo pipefail
arms="$1"; ver="$2"; sel="$3"; live="$4"; out="$5"; ct="$6"; met="$7"
o="${GITHUB_OUTPUT:-/dev/null}"
H() { sha256sum "$1" | cut -c1-64; }
jq -e '.selected.candidate == true and (.selected.arm | type) == "number"' "$sel" > /dev/null || { echo "no selected candidate: refused"; exit 1; }
a=$(jq -r .selected.arm "$sel"); [[ "$a" =~ ^[0-9]$ ]] || { echo "bad selected arm: refused"; exit 1; }
st="$ver/arm-$a.status.json"; test -s "$st" || { echo "selected arm $a was not verified: refused"; exit 1; }
if [ "$(jq -r .saved "$st")" != true ]; then
  echo "selected arm $a was not saved: the candidate is re-trained"; echo "reused=false" >> "$o"; exit 0
fi
d="$arms/$a"; sm="$d/summary.json"; sv="$d/save.json"
[ "$(H "$sv")" = "$(jq -r .saveSha256 "$st")" ] || { echo "save.json changed after verification: refused"; exit 1; }
cmp -s <(jq -cS . "$sm") <(jq -cS . "$ver/arm-$a.json") || { echo "arm summary changed after verification: refused"; exit 1; }
w=$(jq -r .weightsSha256 "$st"); [[ "$w" =~ ^[0-9a-f]{64}$ ]] || { echo "selected arm has no checkpoint: refused"; exit 1; }
test -f "$d/model/weights.npz" || { echo "selected arm checkpoint missing: refused"; exit 1; }
[ "$(H "$d/model/weights.npz")" = "$w" ] && [ "$(jq -r '.files["model/weights.npz"]' "$sv")" = "$w" ] || { echo "checkpoint sha256 does not match the arm summary: refused"; exit 1; }
for f in config.json eval.json; do [ "$(H "$d/model/$f")" = "$(jq -r --arg f "model/$f" '.files[$f]' "$sv")" ] || { echo "model/$f sha256 mismatch: refused"; exit 1; }; done
step=$(jq -r .selected.step "$sel")
jq -e --slurpfile s "$sel" '.bestStep == $s[0].selected.step and .lr == $s[0].selected.lr and .arm == $s[0].selected.arm' "$sm" > /dev/null || { echo "saved arm is not the selected arm/step: refused"; exit 1; }
[ "$(jq -r .trained_steps "$d/model/config.json")" = "$step" ] && [ "$(jq -r .version "$d/model/config.json")" = "lm-v1-${w:0:12}" ] || { echo "checkpoint is not at the selected step: refused"; exit 1; }
[ "$(H "$live/tokenizer.json")" = "$(jq -r .tokenizerSha256 "$sv")" ] || { echo "tokenizer differs from the arm's: refused"; exit 1; }
# the re-train path's identity checks, on the reused arm (jq -cS on both sides)
test "$(jq -cS .valSplit "$sm")" = "$(jq -cS .validationSplit "$sel")" || { echo "candidate used a different validation split: refused"; exit 1; }
test "$(jq -cS .replay.val "$sm")" = "$(jq -cS '.arms[0].replay.val' "$sel")" || { echo "candidate used different validation windows: refused"; exit 1; }
test "$(jq -cS .replay.corpus "$sm")" = "$(jq -cS '.arms[0].replay.corpus' "$sel")" || { echo "candidate used a different replay corpus: refused"; exit 1; }
test "$(jq -r .mode "$sm")" = "$(jq -r .mode "$sel")" || { echo "candidate ran in a different mode: refused"; exit 1; }
rm -rf "$out"; mkdir -p "$out"
cp "$d/model/config.json" "$d/model/weights.npz" "$d/model/eval.json" "$out/"; cp "$live/tokenizer.json" "$out/tokenizer.json"
[ "$(H "$out/weights.npz")" = "$w" ] || { echo "copied checkpoint sha256 mismatch: refused"; exit 1; }
cp "$d/metrics.jsonl" "$met"
jq -c --argjson step "$step" --slurpfile s "$st" --argjson a "$a" \
  '. + {stoppedStep: $step, armStoppedStep: .stoppedStep, source: {kind: "sweep-arm", runId: $s[0].runId, workspaceSha: $s[0].workspaceSha, arm: $a, weightsSha256: $s[0].weightsSha256, saveSha256: $s[0].saveSha256}}' "$sm" > "$ct"
echo "candidate reused from sweep arm $a at the selected step (weights sha256 verified)"
echo "reused=true" >> "$o"
