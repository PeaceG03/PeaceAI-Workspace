#!/usr/bin/env bash
# Daily cycle on GitHub (peace-lb-daily.yml): one lb-daily-cycle.sh day with the settings from lb-train.json dailyRun
# (lb_daily.py cycle-args), the budget cut to the job's train deadline, and LB_DAILY_EXPECT taken from the trusted record
# (fresh, or resume:<manifest sha256 of the trusted Results row>). STATE was prepared by lb_daily.py restore (the R2 save
# already checked against the trusted sha256, chain.json written from the trusted record). No credentials reach this
# script (the workflow step has none). Output: the plan line and the daily line (codes, steps, metrics, shas) only.
# Usage: PY=python LB_JOB_START=EPOCH LB_TODAY=YYYY-MM-DD lb-daily-run.sh CORPUS STATE TRUSTED_FILE TRUSTED_SHA
set -uo pipefail
[ $# -eq 4 ] || { echo "LB_DAILY_BAD_ARGS"; exit 3; }
C=$1 S=$2 T=$3 TS=$4
PY=${PY:-python3}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
M=${LB_MODEL_DIR:-$here/../model}  # LB_MODEL_DIR: tests only (a scratch copy of peaceai/model)
[[ "${LB_TODAY:-}" =~ ^20[0-9]{2}-[0-9]{2}-[0-9]{2}$ ]] || { echo "LB_DAILY_BAD_ARGS"; exit 3; }
out=$("$PY" "$M/lb_daily.py" cycle-args --trusted "$T" --trusted-sha "$TS" --job-start "${LB_JOB_START:-}") || { echo "${out##*$'\n'}"; exit 3; }
mapfile -t A <<<"$out"
[ "${#A[@]}" -ge 2 ] || { echo "LB_DAILY_BAD_ARGS"; exit 3; }
LB_DAILY_EXPECT="${A[1]}" PEACEAI_PYTHON="$PY" "$M/../bin/lb-daily-cycle.sh" "$C" "$S" "${A[0]}" "$LB_TODAY" -- "${A[@]:2}"
