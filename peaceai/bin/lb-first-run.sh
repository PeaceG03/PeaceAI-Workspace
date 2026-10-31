#!/usr/bin/env bash
# lb-train v1 first run (Auditor ruling after #654), run by peace-lm-train.yml (input run=lb-first-run) after
# lb-corpus-rebuild.sh. Usage: lb-first-run.sh <corpus dir> <work dir> <model dir> <row file>
# Env: PY (python with the hash-pinned numpy), LB_JOB_START (epoch seconds at the job start), GITHUB_REF, GITHUB_SHA,
# GITHUB_RUN_ID. LB_MODEL_DIR overrides the model dir for local tests only.
# Order: ref gate, the three corpus pins, the guarded train.py argv (lb-train.json firstRun only: easy_to_hard,
# adamw8bit, patience, deadline inside the job cap; no LoRA, no replay, no init/resume, no saves), train, export (held-out
# bpb AND the unigram baseline on the same held-out windows), then the metrics-only row. Weights, checkpoints and the
# corpus never leave the runner: the work, model and corpus dirs are deleted here; logs carry codes, pins, shas, metrics.
set -euo pipefail
M="${LB_MODEL_DIR:-$(cd "$(dirname "$0")/../model" && pwd)}"
C="${1:?corpus dir}"; W="${2:?work dir}"; O="${3:?model dir}"; ROW="${4:?row file}"
: "${PY:?PY}" "${LB_JOB_START:?LB_JOB_START}"
cleanup() { rm -rf "$W" "$O" "$C" "$W.log"; }
trap cleanup EXIT
lb() { "$PY" "$M/lb_run.py" "$@"; }
lb ref --ref "${GITHUB_REF:-}"
lb pins --corpus "$C"
argv=$(lb train-argv --corpus "$C" --work "$W" --job-start "$LB_JOB_START") || { echo "$argv"; exit 3; }
mapfile -t A <<< "$argv"
"$PY" "$M/train.py" "${A[@]}" > "$W.log" 2>&1 || { rc=$?; echo "train failed exit=$rc"; jq -r '"stop reason=\(.reason) code=\(.code // "")"' "$W/stop.json" 2>/dev/null || true; exit 1; }
grep -E '^(params=|tokens |optimizer=|curriculum |best val_loss|stopped )' "$W.log" || true
ck=best.npz; test -f "$W/best.npz" || ck=checkpoint.npz
"$PY" "$M/export.py" --work "$W" --out "$O" --threads 4 --checkpoint "$ck" > /dev/null
lb row --corpus "$C" --work "$W" --eval "$O/eval.json" --checkpoint "$W/$ck" --run-id "${GITHUB_RUN_ID:-}" --sha "${GITHUB_SHA:-}" \
  --job-start "$LB_JOB_START" --out "$ROW"
