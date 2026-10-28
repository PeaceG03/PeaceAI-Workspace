#!/usr/bin/env bash
# LM retrain memcheck: verify the landed candidate in a sparse Results checkout and stage it for lm-memcheck.ts
# (run 40694718190 follow-up; Auditor's ruling). Used by peace-lm-retrain.yml retrain-memcheck for this run's candidate
# and for the memcheck-only path (input memcheck_only_run_id: an already-landed candidate of an earlier run).
#   [MCO=<run>] lm-retrain-memcheck-fetch.sh <results checkout> <out dir> <run id> [<version>]
# Needs in the checkout: runs/lm-retrain/<run>/record.json, models/lm/<version>/ and, for a pretrain-mode candidate,
# models/lm/<lm-retrain.json live.version>/corefree-proof.json. <version> empty: the record's candidate.
# Refuses unless: no symlinks; the record is this run's and names this candidate; the weights hash to the version and to
# the record's candidateWeightsSha256; config.json retrain.runId is the run; the fine-tune proof hashes to the record's
# finetuneCorefreeProofSha256; pretrain mode: the live proof hashes to lm-retrain.json live.corefreeProofSha256.
# Memcheck-only (MCO set, must equal <run>): the run's first memcheck record must exist and bind the same config,
# tokenizer and weights sha256 (the only record of the config/tokenizer shas); without MCO it must not exist yet.
# Writes <out>/model/ (the model files, no memcheck.json), <out>/live-proof.json (pretrain), <out>/ft-proof-sha256,
# <out>/version. Prints shas only.
set -euo pipefail
res="$1"; out="$2"; run="$3"; V="${4:-}"; mco="${MCO:-}"
cfg="${PEACEAI_LM_RETRAIN_CFG:-peaceai/model/lm-retrain.json}"
no() { echo "memcheck fetch: $1: refused"; exit 1; }
[[ "$run" =~ ^[1-9][0-9]{5,19}$ ]] || no "bad run id"
[ -z "$mco" ] || [ "$mco" = "$run" ] || no "memcheck-only run id is not the run checked"
r="$res/runs/lm-retrain/$run"; rec="$r/record.json"
[ -d "$r" ] && [ ! -L "$r" ] && [ -f "$rec" ] && [ ! -L "$rec" ] || no "no run record"
[ -z "$(find "$r" -type l)" ] || no "symlink in run dir"
test "$(jq -r '.runId | tostring' "$rec")" = "$run" || no "record is not this run's"
[ -n "$V" ] || V=$(jq -r '.candidate // ""' "$rec")
[[ "$V" =~ ^lm-v1-[0-9a-f]{12}$ ]] || no "bad version"
test "$(jq -r '.candidate // ""' "$rec")" = "$V" || no "record names another candidate"
d="$res/models/lm/$V"
[ -d "$d" ] && [ ! -L "$d" ] || no "no model dir"
[ -z "$(find "$d" -type l)" ] || no "symlink in model dir"
for f in config.json tokenizer.json weights.npz corefree-proof-finetune.json; do [ -f "$d/$f" ] || no "model dir lacks $f"; done
s() { sha256sum "$1" | cut -c1-64; }
w=$(s "$d/weights.npz")
test "lm-v1-${w:0:12}" = "$V" || no "weights do not hash to the version"
test "$(jq -r '.candidateWeightsSha256 // ""' "$rec")" = "$w" || no "weights differ from the record's candidateWeightsSha256"
test "$(jq -r '.retrain.runId | tostring' "$d/config.json")" = "$run" || no "model is not from this run"
fp=$(s "$d/corefree-proof-finetune.json")
test "$(jq -r '.finetuneCorefreeProofSha256 // ""' "$rec")" = "$fp" || no "fine-tune proof differs from the record's"
if [ -n "$mco" ]; then
  m="$r/memcheck.json"
  [ -f "$m" ] || no "memcheck-only: the run has no first memcheck record binding config/tokenizer"
  jq -e --arg c "$(s "$d/config.json")" --arg t "$(s "$d/tokenizer.json")" --arg w "$w" --arg v "$V" \
    '.files["config.json"] == $c and .files["tokenizer.json"] == $t and .files["weights.npz"] == $w and .model == $v' "$m" > /dev/null \
    || no "memcheck-only: config, tokenizer or weights differ from the run's first memcheck record"
else
  [ ! -e "$r/memcheck.json" ] || no "this run already has a memcheck record"
fi
rm -rf "$out/model"; mkdir -p "$out/model"
cp "$d/config.json" "$d/tokenizer.json" "$d/weights.npz" "$d/corefree-proof-finetune.json" "$out/model/"
rm -f "$out/live-proof.json"
if [ "$(jq -r .retrain.mode "$d/config.json")" = pretrain ]; then
  live=$(jq -r .live.version "$cfg"); [[ "$live" =~ ^lm-v1-[0-9a-f]{12}$ ]] || no "bad live version"
  lp="$res/models/lm/$live/corefree-proof.json"
  [ -f "$lp" ] && [ ! -L "$lp" ] || no "no live core-free proof"
  test "$(s "$lp")" = "$(jq -r .live.corefreeProofSha256 "$cfg")" || no "live core-free proof differs from its pin"
  cp "$lp" "$out/live-proof.json"
fi
printf '%s\n' "$fp" > "$out/ft-proof-sha256"; printf '%s\n' "$V" > "$out/version"
echo "memcheck fetch: run=$run candidate=$V weights=$w finetuneProof=$fp memcheckOnly=${mco:+true}"
