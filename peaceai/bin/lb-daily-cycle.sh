#!/usr/bin/env bash
# M160 limit-breaker daily cycle: plan (checks) -> train within the budget, resuming from the latest verified local save
# -> evaluate -> report. Local / free compute only; no network, no upload, no cloud storage; writes only under STATE.
# NOT scheduled anywhere (peaceai/spec/lb-train-v1.md holds a drafted, uninstalled workflow_dispatch wrapper).
# Usage: lb-daily-cycle.sh CORPUS STATE BUDGET_MIN [TODAY] [-- <train.py args from lb-train.json daily.trainArgsAllowed>]
set -uo pipefail
[ $# -ge 3 ] || { echo "usage: lb-daily-cycle.sh CORPUS STATE BUDGET_MIN [TODAY] [-- train args]" >&2; exit 2; }
C=$1 S=$2 B=$3; shift 3
D=$(date -u +%Y-%m-%d)
if [ $# -gt 0 ] && [ "$1" != "--" ]; then D=$1; shift; fi
if [ $# -gt 0 ] && [ "$1" = "--" ]; then shift; fi
PY=${PEACEAI_PYTHON:-python3}
M=$(cd "$(dirname "${BASH_SOURCE[0]}")/../model" && pwd)
line=$("$PY" "$M/daily_cycle.py" plan --corpus "$C" --state "$S" --budget-min "$B" --today "$D" -- "$@") || { echo "$line"; exit 3; }
echo "$line"
resume=(); start=0
case "$line" in
  "plan done "*) exit 0 ;;
  "plan fresh start=0") ;;
  "plan resume "*)
    read -r _ _ st sv sh <<<"$line"
    start=${st#start=}; resume=(--resume-from "$S/saves/${sv#save=}" --resume-manifest-sha "${sh#sha=}") ;;
  *) echo "DAILY_PLAN_UNKNOWN"; exit 3 ;;
esac
W="$S/work/$D"; secs=$((B * 60)); deadline=$(( $(date +%s) + secs ))
"$PY" "$M/train.py" --corpus "$C" --work "$W" --save-dir "$S/saves" --marker "$S/chain.json" --max-seconds "$secs" --deadline "$deadline" \
  "${resume[@]}" "$@" >"$S/logs/$D.log" 2>"$S/logs/$D.err"
rc=$?
if [ "$rc" = 0 ]; then
  ck=checkpoint.npz; [ -f "$W/best.npz" ] && ck=best.npz
  "$PY" "$M/export.py" --work "$W" --out "$W/model" --checkpoint "$ck" --threads 1 >/dev/null 2>>"$S/logs/$D.err" || true
fi
"$PY" "$M/daily_cycle.py" report --corpus "$C" --state "$S" --budget-min "$B" --today "$D" --start-step "$start" --train-rc "$rc"
