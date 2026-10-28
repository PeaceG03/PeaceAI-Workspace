#!/usr/bin/env bash
# M125 (durable sweep arms; Peace 2026-10-28 after run 40624227227 lost ~10 h of training): stage one finished sweep arm
# for Results, before select runs. No key here: the workflow copies the stage into Results only through
# lm-retrain-dryrun-guard.sh -> with-deploy-key.sh -> results-write.sh (path allowlist runs/lm-retrain/<run>/arms/<arm>/).
#   lm-retrain-arm-save.sh <arm work> <live dir> <ft corpus> <stage> <arm index>
# Writes <stage>/summary.json (exactly the arm's job-output summary: summary.json + {arm}), <stage>/metrics.jsonl
# (losses only), and, when the arm has a validation-selected step (bestStep > 0), <stage>/model/{config.json,
# weights.npz, eval.json}: train.py's best.npz (the checkpoint at bestStep) exported by export.py, i.e. exactly what
# finetune-eval-land's candidate re-train exports at the selected step. Refuses unless the export is at bestStep and the
# tokenizer is the live one. <stage>/save.json (peaceai-lm-retrain-arm:v1) binds every file by sha256 to this run, arm,
# mode, lr, live version, fine-tune manifest, training config and training/export code (codeSha256) (lm-retrain-arm-verify.sh checks all of it before use).
# Prints counts only. Needs PEACEAI_PYTHON (numpy), MODE, GITHUB_RUN_ID, GITHUB_SHA.
set -euo pipefail
work="$1"; live="$2"; ft="$3"; stage="$4"; arm="$5"
cfg=peaceai/model/lm-retrain.json; py="${PEACEAI_PYTHON:?PEACEAI_PYTHON}"
[ "${DRY_RUN-}" = false ] || { echo "arm save: real runs only: refused"; exit 1; }
mode=$(./peaceai/bin/lm-retrain-mode.sh)
[[ "$arm" =~ ^[0-9]$ ]] || { echo "bad arm index: refused"; exit 1; }
[[ "${GITHUB_RUN_ID-}" =~ ^[1-9][0-9]{0,19}$ && "${GITHUB_SHA-}" =~ ^[0-9a-f]{40}$ ]] || { echo "no run id or workspace sha: refused"; exit 1; }
S="$work/summary.json"; test -s "$S" || { echo "arm has not finished (no summary.json): refused"; exit 1; }
lr=$(jq -r --arg m "$mode" --argjson a "$arm" '.[$m].sweep.lrs[$a]' "$cfg"); [ "$lr" != null ] || { echo "no sweep arm $arm: refused"; exit 1; }
jq -e --argjson lr "$lr" --arg m "$mode" '.lr == $lr and .mode == $m and .stopAt == 0' "$S" > /dev/null || { echo "summary is not this arm's: refused"; exit 1; }
best=$(jq -r .bestStep "$S"); [[ "$best" =~ ^[0-9]+$ ]] || { echo "bad bestStep: refused"; exit 1; }
rm -rf "$stage"; mkdir -p "$stage"
jq -c --argjson arm "$arm" '. + {arm: $arm}' "$S" > "$stage/summary.json"
cp "$work/metrics.jsonl" "$stage/metrics.jsonl"
if [ "$best" -gt 0 ]; then
  test -s "$work/best.npz" || { echo "no best.npz for bestStep $best: refused"; exit 1; }
  cmp -s "$live/tokenizer.json" "$work/tokenizer.json" || { echo "tokenizer changed: refused"; exit 1; }
  "$py" peaceai/model/export.py --work "$work" --out "$stage/model" --threads 4 --checkpoint best.npz > /dev/null
  rm -f "$stage/model/tokenizer.json"   # the live tokenizer (checked above; its sha256 is in save.json)
  test "$(jq -r .trained_steps "$stage/model/config.json")" = "$best" || { echo "exported checkpoint is not at bestStep: refused"; exit 1; }
  test "$(jq -r .version "$stage/model/config.json")" = "lm-v1-$(sha256sum "$stage/model/weights.npz" | cut -c1-12)" || { echo "export version mismatch: refused"; exit 1; }
fi
if [ -n "$(find "$stage" -type l)" ]; then echo "symlink in stage: refused"; exit 1; fi
files=$(cd "$stage" && find . -type f ! -name save.json | sed 's|^\./||' | LC_ALL=C sort | while IFS= read -r f; do jq -n --arg f "$f" --arg h "$(sha256sum "$f" | cut -c1-64)" '{($f): $h}'; done | jq -s 'add // {}')
tc=$(./peaceai/bin/lm-retrain-arm-verify.sh --train-config-sha "$mode"); code=$(./peaceai/bin/lm-retrain-arm-verify.sh --code-sha)
jq -n --arg run "$GITHUB_RUN_ID" --arg ws "$GITHUB_SHA" --argjson arm "$arm" --arg mode "$mode" --argjson lr "$lr" --argjson best "$best" \
  --arg live "$(jq -r .live.version "$cfg")" --arg ftm "$(sha256sum "$ft/manifest.jsonl" | cut -c1-64)" --arg tc "$tc" --arg code "$code" \
  --arg tok "$(sha256sum "$live/tokenizer.json" | cut -c1-64)" --argjson files "$files" \
  '{schema: "peaceai-lm-retrain-arm:v1", runId: $run, workspaceSha: $ws, arm: $arm, mode: $mode, lr: $lr, bestStep: $best, live: $live,
    finetuneManifestSha256: $ftm, trainConfigSha256: $tc, codeSha256: $code, tokenizerSha256: $tok, files: $files}' > "$stage/save.json"
echo "arm $arm staged: files=$(jq '.files | length' "$stage/save.json") model=$([ "$best" -gt 0 ] && echo yes || echo no)"
