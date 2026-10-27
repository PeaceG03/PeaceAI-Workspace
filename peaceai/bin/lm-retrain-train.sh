#!/usr/bin/env bash
# M119 (LM retrain): one fine-tune of the live weights on the retrain corpus, for the sweep and for the final candidate.
#   lm-retrain-train.sh <ft corpus> <dedup.json> <replay corpus> <replay-dedup.json> <live dir> <work> <lr> <stop-at-step>
# <stop-at-step> 0: a sweep arm (up to finetune.steps, early stop after finetune.patience evals without a validation
# improvement). N > 0: the final candidate (same schedule, patience off, stops exactly at step N, exports checkpoint.npz).
# Forgetting fix (run 40375535718): finetune.replayFrac of every batch comes from the replay corpus's train docs (the live
# model's own pretrain train split, lm-retrain-replay.sh), the rest from the fine-tune corpus's train docs.
# Validation = the replay corpus's heldout docs only (pretrain-heldout, finetune.valWindows windows over as many distinct
# docs; val_split.py over the replay corpus; never set C v2, the judge items, or the fine-tune corpus).
# KEEP_CHECKPOINTS=1 (dry run only, needs DRY_RUN=true) keeps ckpt-<step>.npz at every eval for lm-retrain-dryrun-score.sh.
# Writes <work>/summary.json {lr, steps, stopAt, step0Val, bestVal, bestStep, stoppedStep, valAtStop, earlyStop, valSplit,
# replay: {replayFrac, replayRows, ftRows, val: {docs, windows, sha256}}} and prints it; the training log stays in <work>.
# Needs PEACEAI_PYTHON (numpy).
set -euo pipefail
corpus="$1"; dedup="$2"; rcorpus="$3"; rdedup="$4"; live="$5"; work="$6"; lr="$7"; stop="$8"
cfg=peaceai/model/lm-retrain.json; py="${PEACEAI_PYTHON:?PEACEAI_PYTHON}"
m() { jq -r ".model.$1" "$cfg"; }; f() { jq -r ".finetune.$1" "$cfg"; }
[[ "$stop" =~ ^[0-9]+$ ]] || { echo "bad stop step"; exit 1; }
jq -e --argjson lr "$lr" '.finetune.sweep.lrs | index($lr) != null' "$cfg" > /dev/null || { echo "lr is not a configured sweep arm: refused"; exit 1; }
test "$(jq -r .recheckOverlapDocs "$dedup")" = 0 || { echo "fine-tune corpus eval overlap: refused"; exit 1; }
vs=$("$py" peaceai/model/val_split.py --corpus "$rcorpus" --dedup "$rdedup")
keep=(); if [ "${KEEP_CHECKPOINTS:-}" = 1 ]; then [ "${DRY_RUN-}" = true ] || { echo "KEEP_CHECKPOINTS only in a dry run: refused"; exit 1; }; keep=(--keep-checkpoints); fi
rm -rf "$work"; mkdir -p "$work"; cp "$live/tokenizer.json" "$work/"
# train.py --init-from reads checkpoint arrays (p.<name>); the exported live weights are plain <name> (fp16).
"$py" -c 'import numpy as np, sys; z = np.load(sys.argv[1], allow_pickle=False); np.savez(sys.argv[2], **{"p." + k: z[k] for k in z.files})' "$live/weights.npz" "$work/init.npz"
if [ "$stop" = 0 ]; then extra=(--patience "$(f patience)" --max-seconds "$(f maxSeconds)"); else extra=(--patience 0 --max-steps-this-run "$stop" --max-seconds "$(f retrainMaxSeconds)"); fi
"$py" peaceai/model/train.py --corpus "$corpus" --work "$work" --init-from "$work/init.npz" \
  --replay-corpus "$rcorpus" --replay-frac "$(f replayFrac)" --val-windows "$(f valWindows)" --val-seed "$(f valSeed)" "${keep[@]}" \
  --ctx "$(m ctx)" --d-model "$(m d_model)" --n-layer "$(m n_layer)" --n-head "$(m n_head)" --vocab "$(m vocab)" --batch "$(m batch)" \
  --steps "$(f steps)" --lr "$lr" --warmup "$(f warmup)" --eval-every "$(f evalEvery)" --seed "$(f seed)" --threads 4 "${extra[@]}" \
  > "$work/train.log" 2>&1 || { echo "fine-tune failed exit=$?"; exit 1; }
rm -f "$work/init.npz"
grep -q '^initialized from weights' "$work/train.log" || { echo "fine-tune did not start from the live weights: refused"; exit 1; }
cmp -s "$live/tokenizer.json" "$work/tokenizer.json" || { echo "tokenizer changed: refused"; exit 1; }
jq -e --argjson n "$(f valWindows)" --argjson fr "$(f replayFrac)" --arg vseed "$(f valSeed)" '.val.windows == $n and .val.docs == $n and .val.seed == $vseed and .replayFrac == $fr' "$work/replay.json" > /dev/null \
  || { echo "replay share or validation windows differ from the config: refused"; exit 1; }
"$py" peaceai/model/retrain_summary.py "$work/metrics.jsonl" "$lr" "$(f steps)" "$stop" "$(grep -c '(early stop)' "$work/train.log" || true)" "$vs" \
  | jq -c --slurpfile r "$work/replay.json" '. + {replay: ($r[0] | {replayFrac, replayRows, ftRows, val})}' > "$work/summary.json"
cat "$work/summary.json"
