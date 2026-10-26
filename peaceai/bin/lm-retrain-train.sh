#!/usr/bin/env bash
# M119 (LM retrain): one fine-tune of the live weights on the retrain corpus, for the sweep and for the final candidate.
#   lm-retrain-train.sh <ft corpus> <dedup.json> <live dir> <work> <lr> <stop-at-step>
# <stop-at-step> 0: a sweep arm (up to finetune.steps, early stop after finetune.patience evals without a validation
# improvement). N > 0: the final candidate (same schedule, patience off, stops exactly at step N, exports checkpoint.npz).
# Validation = the corpus's own heldout split only (val_split.py; never set C v2 or the judge items).
# Writes <work>/summary.json {lr, steps, stopAt, step0Val, bestVal, bestStep, stoppedStep, valAtStop, earlyStop, valSplit}
# and prints it; the training log stays in <work>. Needs PEACEAI_PYTHON (numpy).
set -euo pipefail
corpus="$1"; dedup="$2"; live="$3"; work="$4"; lr="$5"; stop="$6"
cfg=peaceai/model/lm-retrain.json; py="${PEACEAI_PYTHON:?PEACEAI_PYTHON}"
m() { jq -r ".model.$1" "$cfg"; }; f() { jq -r ".finetune.$1" "$cfg"; }
[[ "$stop" =~ ^[0-9]+$ ]] || { echo "bad stop step"; exit 1; }
jq -e --argjson lr "$lr" '.finetune.sweep.lrs | index($lr) != null' "$cfg" > /dev/null || { echo "lr is not a configured sweep arm: refused"; exit 1; }
vs=$("$py" peaceai/model/val_split.py --corpus "$corpus" --dedup "$dedup")
rm -rf "$work"; mkdir -p "$work"; cp "$live/tokenizer.json" "$work/"
# train.py --init-from reads checkpoint arrays (p.<name>); the exported live weights are plain <name> (fp16).
"$py" -c 'import numpy as np, sys; z = np.load(sys.argv[1], allow_pickle=False); np.savez(sys.argv[2], **{"p." + k: z[k] for k in z.files})' "$live/weights.npz" "$work/init.npz"
if [ "$stop" = 0 ]; then extra=(--patience "$(f patience)" --max-seconds "$(f maxSeconds)"); else extra=(--patience 0 --max-steps-this-run "$stop" --max-seconds "$(f retrainMaxSeconds)"); fi
"$py" peaceai/model/train.py --corpus "$corpus" --work "$work" --init-from "$work/init.npz" \
  --ctx "$(m ctx)" --d-model "$(m d_model)" --n-layer "$(m n_layer)" --n-head "$(m n_head)" --vocab "$(m vocab)" --batch "$(m batch)" \
  --steps "$(f steps)" --lr "$lr" --warmup "$(f warmup)" --eval-every "$(f evalEvery)" --seed "$(f seed)" --threads 4 "${extra[@]}" \
  > "$work/train.log" 2>&1 || { echo "fine-tune failed exit=$?"; exit 1; }
rm -f "$work/init.npz"
grep -q '^initialized from weights' "$work/train.log" || { echo "fine-tune did not start from the live weights: refused"; exit 1; }
cmp -s "$live/tokenizer.json" "$work/tokenizer.json" || { echo "tokenizer changed: refused"; exit 1; }
"$py" - "$work/metrics.jsonl" "$lr" "$(f steps)" "$stop" "$(grep -c '(early stop)' "$work/train.log" || true)" "$vs" > "$work/summary.json" <<'PY'
import json, sys
path, lr, steps, stop, early, vs = sys.argv[1], float(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), json.loads(sys.argv[6])
rows = [json.loads(l) for l in open(path) if l.strip()]
val = [(r["step"], r["val_loss"]) for r in rows if "val_loss" in r]
if not val or val[0][0] != 0:
    sys.exit("no step-0 validation loss")
after = [v for v in val if v[0] > 0]
if not after:
    sys.exit("no validation loss after step 0")
best = min(after, key=lambda v: (v[1], v[0]))
stopped = max(r["step"] for r in rows)
print(json.dumps({"lr": lr, "steps": steps, "stopAt": stop, "step0Val": val[0][1], "bestVal": best[1], "bestStep": best[0],
                  "stoppedStep": stopped, "valAtStop": dict(val).get(stopped), "earlyStop": early > 0, "valSplit": vs}, sort_keys=True))
PY
cat "$work/summary.json"
