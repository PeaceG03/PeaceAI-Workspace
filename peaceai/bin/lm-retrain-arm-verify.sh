#!/usr/bin/env bash
# M125 (durable sweep arms): verify the sweep arms saved in Results (runs/lm-retrain/<run>/arms/<arm>/, written by
# lm-retrain-arm-save.sh in each sweep job) before finetune-eval-land uses them. No key here (the fetch is a separate,
# key-using step). Counts only on stdout.
#   lm-retrain-arm-verify.sh --train-config-sha <mode>
#       prints the sha256 of the training identity: lm-retrain.json {model, live, replay, dedup, <mode> minus budget/note},
#       where live is {version, corefreeProofSha256} of replayBase (the retired top-level live entry had exactly these
#       values, so the identity, and every saved arm's trainConfigSha256, is unchanged by its removal)
#   lm-retrain-arm-verify.sh --code-sha
#       prints the sha256 of the training and export code (Auditor, PR #564): `sha256sum` of exactly CODE_FILES, in this
#       fixed sorted order (lm-retrain-train.sh runs val_split.py, train.py and retrain_summary.py; train.py imports lm
#       and replay; export.py imports lm), piped through sha256sum. save.json carries it as codeSha256; a resume refuses
#       unless it equals this checkout's (a resumed run never scores weights made by different code unnoticed).
#   lm-retrain-arm-verify.sh <fetched arms dir> <dest>
#       env: MODE, CFG-free (reads peaceai/model/lm-retrain.json), MANIFEST (this run's proven fine-tune manifest sha256),
#       GITHUB_RUN_ID, RESUME ("" = this run's own arms; else the run id whose saved arms this run resumes from),
#       SA / SB (this run's sweep-a / sweep-b summary outputs; "" in a resume), VA / VB (their "saved" outputs: the
#       {saveSha256, weightsSha256} the arm job wrote only after its Results push succeeded; "" = the save failed).
# Writes <dest>/arm-<i>.json (the arm summary the select rule reads) and <dest>/arm-<i>.status.json {saved, reusable,
# weightsSha256, saveSha256, runId, workspaceSha} for every configured arm.
#   This run's arms: an arm whose save failed (VA/VB "") is "missing" (saved false, reusable false): its job summary
#   is used and finetune-eval-land re-trains the candidate if that arm is selected (the pre-M125 path). An arm whose
#   save succeeded must be in Results and match: save.json hashes to the job's saveSha256, every file hashes to
#   save.json, summary.json equals the job summary (jq -cS), the weights hash to the job's weightsSha256.
#   Resume: every arm must be saved (no job summaries exist); same file checks; save.runId must be RESUME; save.codeSha256
#   must equal this checkout's training/export code sha256 (--code-sha).
#   Both: run, arm, mode, lr, live version, fine-tune manifest and training config must equal this run's. Any mismatch
#   refuses (exit 1).
set -euo pipefail
cfg=peaceai/model/lm-retrain.json
tcsha() { jq -cS --arg m "$1" '{model, live: {version: .replayBase.version, corefreeProofSha256: .replayBase.corefreeProofSha256}, replay, dedup, train: (.[$m] | del(.budget, .note))}' "$cfg" | sha256sum | cut -c1-64; }
CODE_FILES=(peaceai/model/export.py peaceai/model/lm.py peaceai/model/replay.py peaceai/model/retrain_summary.py peaceai/model/train.py peaceai/model/val_split.py)
codesha() { sha256sum "${CODE_FILES[@]}" | sha256sum | cut -c1-64; }
if [ "${1-}" = --code-sha ]; then codesha; exit 0; fi
if [ "${1-}" = --train-config-sha ]; then case "${2-}" in finetune | pretrain) tcsha "$2"; exit 0 ;; *) echo "bad mode: refused"; exit 1 ;; esac; fi
arms="$1"; dest="$2"
mode=$(./peaceai/bin/lm-retrain-mode.sh)
refuse() { echo "saved arm $1: $2: refused"; exit 1; }
H() { sha256sum "$1" | cut -c1-64; }
[[ "${MANIFEST-}" =~ ^[0-9a-f]{64}$ ]] || { echo "no proven manifest: refused"; exit 1; }
[[ "${GITHUB_RUN_ID-}" =~ ^[1-9][0-9]{0,19}$ ]] || { echo "no run id: refused"; exit 1; }
src="$GITHUB_RUN_ID"
if [ -n "${RESUME-}" ]; then
  [[ "$RESUME" =~ ^[1-9][0-9]{5,19}$ ]] && [ "$RESUME" != "$GITHUB_RUN_ID" ] || { echo "bad resume run id: refused"; exit 1; }
  src="$RESUME"; [ -z "${SA-}${SB-}${VA-}${VB-}" ] || { echo "resume with sweep outputs: refused"; exit 1; }
fi
n=$(jq -r --arg m "$mode" '.[$m].sweep.lrs | length' "$cfg"); [ "$n" = 2 ] || { echo "expected 2 sweep arms: refused"; exit 1; }
sums=("${SA-}" "${SB-}"); saves=("${VA-}" "${VB-}")
tc=$(tcsha "$mode"); code=$(codesha); live=$(jq -r .replayBase.version "$cfg")
mkdir -p "$dest"
for i in 0 1; do
  d="$arms/$i"; st="$dest/arm-$i.status.json"; lr=$(jq -r --arg m "$mode" --argjson a "$i" '.[$m].sweep.lrs[$a]' "$cfg")
  if [ -z "${RESUME-}" ]; then
    S="${sums[$i]}"; V="${saves[$i]}"
    jq -e 'type == "object"' <<< "$S" > /dev/null 2>&1 || refuse "$i" "no job summary"
    if [ -z "$V" ]; then
      [ ! -e "$d" ] || refuse "$i" "in Results but the job recorded no save"
      jq -c . <<< "$S" > "$dest/arm-$i.json"
      jq -n --arg r "$src" '{saved: false, reusable: false, weightsSha256: null, saveSha256: null, runId: $r, workspaceSha: null}' > "$st"
      echo "arm $i: not saved (its save failed); a selected candidate from it is re-trained"; continue
    fi
    jq -e '(.saveSha256 | type == "string" and test("^[0-9a-f]{64}$")) and (.weightsSha256 == null or (.weightsSha256 | type == "string" and test("^[0-9a-f]{64}$")))' <<< "$V" > /dev/null 2>&1 || refuse "$i" "bad saved output"
    test -f "$d/save.json" || refuse "$i" "saved by its job but missing from Results"
    [ "$(H "$d/save.json")" = "$(jq -r .saveSha256 <<< "$V")" ] || refuse "$i" "save.json sha256 mismatch"
  else
    test -f "$d/save.json" || refuse "$i" "not saved in run $src (resume needs every arm)"
  fi
  [ -z "$(find "$d" -type l)" ] || refuse "$i" "symlink"
  sv="$d/save.json"
  jq -e '.schema == "peaceai-lm-retrain-arm:v1" and (.files | type) == "object"' "$sv" > /dev/null 2>&1 || refuse "$i" "bad save.json"
  have=$(cd "$d" && find . -type f ! -name save.json | sed 's|^\./||' | LC_ALL=C sort | paste -sd' ')
  [ "$have" = "$(jq -r '.files | keys | sort | join(" ")' "$sv")" ] || refuse "$i" "file set differs from save.json"
  while IFS=$'\t' read -r f h; do [ "$(H "$d/$f")" = "$h" ] || refuse "$i" "sha256 mismatch ($f)"; done < <(jq -r '.files | to_entries[] | "\(.key)\t\(.value)"' "$sv")
  jq -e --arg r "$src" --argjson a "$i" --arg m "$mode" --argjson lr "$lr" --arg l "$live" --arg f "$MANIFEST" --arg tc "$tc" \
    '.runId == $r and .arm == $a and .mode == $m and .lr == $lr and .live == $l and .finetuneManifestSha256 == $f and .trainConfigSha256 == $tc' "$sv" > /dev/null \
    || refuse "$i" "not this run's arm (run, arm, mode, lr, live, manifest or training config differ)"
  [ -z "${RESUME-}" ] || [ "$(jq -r .codeSha256 "$sv")" = "$code" ] || refuse "$i" "training/export code differs from this checkout's (codeSha256)"
  sm="$d/summary.json"; best=$(jq -r .bestStep "$sv")
  jq -e --argjson a "$i" --argjson b "$best" '.arm == $a and .bestStep == $b' "$sm" > /dev/null 2>&1 || refuse "$i" "summary is not the saved arm's"
  [ -z "${RESUME-}" ] && { [ "$(jq -cS . "$sm")" = "$(jq -cS . <<< "$S")" ] || refuse "$i" "summary differs from the job summary"; }
  w=null
  if [ "$best" -gt 0 ]; then
    for f in model/config.json model/weights.npz model/eval.json; do jq -e --arg f "$f" '.files | has($f)' "$sv" > /dev/null || refuse "$i" "no $f"; done
    w=$(H "$d/model/weights.npz")
    [ -z "${RESUME-}" ] && { [ "$w" = "$(jq -r .weightsSha256 <<< "$V")" ] || refuse "$i" "weights sha256 differs from the job summary"; }
    [ "$(jq -r .version "$d/model/config.json")" = "lm-v1-${w:0:12}" ] && [ "$(jq -r .trained_steps "$d/model/config.json")" = "$best" ] || refuse "$i" "model is not the bestStep export"
    w="\"$w\""
  else
    [ ! -e "$d/model" ] || refuse "$i" "a model for bestStep 0"
    [ -n "${RESUME-}" ] || [ "$(jq -r .weightsSha256 <<< "$V")" = null ] || refuse "$i" "weights in the job summary for bestStep 0"
  fi
  jq -c . "$sm" > "$dest/arm-$i.json"
  jq -n --arg r "$src" --argjson w "$w" --arg s "$(H "$sv")" --argjson b "$best" --arg ws "$(jq -r .workspaceSha "$sv")" '{saved: true, reusable: ($b > 0), weightsSha256: $w, saveSha256: $s, runId: $r, workspaceSha: $ws}' > "$st"
  echo "arm $i: saved arm verified (files=$(jq '.files | length' "$sv"))"
done
