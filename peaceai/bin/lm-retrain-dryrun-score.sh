#!/usr/bin/env bash
# LM retrain dry run only (DRY_RUN=true): AFTER a sweep arm has finished training, score each kept checkpoint and the
# live model on set C v2 (same byte slice as the gate: eval.setcMaxBytes, slice sha256 must equal eval.setcSliceSha256)
# and print ONLY "dry-run arm=<n> lr=<lr> step=<s> setc_bpb=<x>" lines plus one "dry-run live setc_bpb=<x>" line, then
# one "dry-run arm=<n> phase setup_s=.. train_s=.. eval_s=.. score_s=.. job_s=.." line (numbers only: the arm's
# timing.json seconds, this scoring's seconds, and seconds since JOB_START, -1 if unset) to size the pretrain budget.
# Set C is fetched here (ext-fetch.ts --set-c, anonymous), after training; nothing here feeds early stopping or step
# selection (the arm's summary.json is already written). Writes nothing outside <scratch>, which it deletes.
#   DRY_RUN=true lm-retrain-dryrun-score.sh <arm work> <live dir> <arm> <lr> <scratch>
set -euo pipefail
[ "${DRY_RUN-}" = true ] || { echo "dryrun-score: only in a dry run: refused"; exit 1; }
work="$1"; live="$2"; arm="$3"; lr="$4"; s="$5"
cfg=peaceai/model/lm-retrain.json; py="${PEACEAI_PYTHON:?PEACEAI_PYTHON}"
[ -f "$work/summary.json" ] || { echo "dryrun-score: arm has not finished: refused"; exit 1; }
mb=$(jq -r .eval.setcMaxBytes "$cfg"); want=$(jq -r .eval.setcSliceSha256 "$cfg")
rm -rf "$s"; mkdir -p "$s"
./node_modules/.bin/tsx peaceai/bin/ext-fetch.ts "$s/csrc" "$s/setc" --set-c > /dev/null; rm -rf "$s/csrc"
score() { # <model dir> <label>
  out=$("$py" peaceai/model/eval_c.py --model "$1" --corpus "$s/setc" --max-bytes "$mb" --threads 4)
  sl=$(printf '%s\n' "$out" | sed -n 's/.*slice_sha256=\([0-9a-f]*\).*/\1/p' | tail -1)
  bpb=$(printf '%s\n' "$out" | sed -n 's/.*bits_per_byte=\([0-9.]*\).*/\1/p' | tail -1)
  [ "$sl" = "$want" ] || { echo "dryrun-score: set C slice differs from the pinned one: refused"; exit 1; }
  echo "dry-run $2 setc_bpb=$bpb"
}
t_score=$(date +%s)
score "$live" "live"
n=0
for c in $(cd "$work" && ls ckpt-*.npz 2>/dev/null | sed 's/^ckpt-\([0-9]*\)\.npz$/\1/' | sort -n); do
  "$py" peaceai/model/export.py --work "$work" --out "$s/m" --threads 4 --checkpoint "ckpt-$c.npz" > /dev/null
  score "$s/m" "arm=$arm lr=$lr step=$c"; rm -rf "$s/m"; n=$((n + 1))
done
[ "$n" -gt 0 ] || { echo "dryrun-score: no kept checkpoints"; exit 1; }
num='^[0-9]+([.][0-9]+)?$'
read -r ps pt pe < <(jq -r '[.setupSeconds, .trainSeconds, .evalSeconds] | map(tostring) | join(" ")' "$work/timing.json")
psc=$(( $(date +%s) - t_score )); pj=-1; [[ "${JOB_START-}" =~ ^[0-9]+$ ]] && pj=$(( $(date +%s) - JOB_START ))
[[ "$ps" =~ $num && "$pt" =~ $num && "$pe" =~ $num ]] || { echo "dryrun-score: bad timing record: refused"; exit 1; }
echo "dry-run arm=$arm phase setup_s=$ps train_s=$pt eval_s=$pe score_s=$psc job_s=$pj"
rm -rf "$s"
