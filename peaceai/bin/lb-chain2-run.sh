#!/usr/bin/env bash
# lb-chain2 v1 (spec peaceai/spec/lb-chain2-v1.md): one chain-2 day of peace-lb-chain2.yml. The lb-daily cycle
# (lb-daily-cycle.sh) with lb-train.json chain2Run settings (lb_chain2.py cycle-args: the budget, LB_DAILY_EXPECT, the
# train args and the warm-start flags), then the separate heldout_v2 evaluation (eval_v2.py) when the day trained.
# STATE and WARM were prepared by lb_chain2.py restore (the warm save verified against its pin, or the chain-2 resume
# save against the trusted record). CORPUS passed lb_chain2.py pins. No credentials reach this script (the workflow step
# has none). Output: codes, steps, metrics and shas only. Fail fast (batch 17): -e on top of -u / pipefail, and a
# failed heldout_v2 evaluation exits 4 (LB_C2_EVAL_V2_FAILED) BEFORE the workflow copies the save to R2: the row needs
# eval-v2.json, so a day without it would only leave an orphan save in R2 and fail later.
# Usage: PY=python LB_JOB_START=EPOCH LB_TODAY=YYYY-MM-DD lb-chain2-run.sh CORPUS STATE TRUSTED_FILE TRUSTED_SHA WARM
set -euo pipefail
[ $# -eq 5 ] || { echo "LB_C2_BAD_ARGS"; exit 3; }
C=$1 S=$2 T=$3 TS=$4 WD=$5
PY=${PY:-python3}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
M=${LB_MODEL_DIR:-$here/../model}  # LB_MODEL_DIR: tests only (a scratch copy of peaceai/model)
[[ "${LB_TODAY:-}" =~ ^20[0-9]{2}-[0-9]{2}-[0-9]{2}$ ]] || { echo "LB_C2_BAD_ARGS"; exit 3; }
out=$("$PY" "$M/lb_chain2.py" cycle-args --trusted "$T" --trusted-sha "$TS" --job-start "${LB_JOB_START:-}" --warm "$WD") || { echo "${out##*$'\n'}"; exit 3; }
mapfile -t A <<<"$out"
[ "${#A[@]}" -ge 2 ] || { echo "LB_C2_BAD_ARGS"; exit 3; }
rc=0
LB_DAILY_EXPECT="${A[1]}" PEACEAI_PYTHON="$PY" "$M/../bin/lb-daily-cycle.sh" "$C" "$S" "${A[0]}" "$LB_TODAY" -- "${A[@]:2}" || rc=$?
[ "$rc" = 0 ] || exit "$rc"
W="$S/work/$LB_TODAY"
if [ -f "$W/model/eval.json" ]; then
  "$PY" "$M/eval_v2.py" --corpus "$C" --work "$W" --threads 1 2>"$S/logs/$LB_TODAY.eval-v2.err" || { echo "LB_C2_EVAL_V2_FAILED"; exit 4; }
fi
