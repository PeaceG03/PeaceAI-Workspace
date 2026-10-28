#!/usr/bin/env bash
# M123 retrain outcome (run 40555453905 follow-up; Auditor's design 2). The last job of peace-lm-retrain.yml, always().
# env: DRY_RUN (exactly "true" or "false"), SEL / MC / REC (needs.<job>.result of finetune-eval-land, retrain-memcheck,
# record-memcheck), SA / SB (the sweep arms' summary outputs), CFG, MODE (validated by lm-retrain-mode.sh),
# REC_LANDED ("true" once record-memcheck landed its record) and MC_STATUS (the recorded memcheck status), MCO (input
# memcheck_only_run_id; empty unless memcheck-only).
#   real run: exit 0 only if select, memcheck and record all succeeded. Run 40694718190: a record that landed with
#             status FAIL prints "memcheck FAIL (record landed)" (still RED), not the generic "did not succeed".
#   memcheck-only: exit 0 only if memcheck and record succeeded (select is skipped by design); same FAIL message.
#   dry run:  exit 0 only if every sweep arm left a non-empty, parseable summary that stopped on "steps" or "patience"
#             (train.py's early stop) and peaceai/model/sweep_select.py, the select step's own rule, picks a candidate
#             arm/step; the pick is printed. Anything else exits 1.
set -euo pipefail
echo "outcome dry_run=${DRY_RUN:-} select=${SEL:-} memcheck=${MC:-} record=${REC:-}"
[ -z "${MC_STATUS:-}${REC_LANDED:-}${MCO:-}" ] || echo "outcome recorded_status=${MC_STATUS:-} record_landed=${REC_LANDED:-} memcheck_only_run=${MCO:-}"
red() { echo "$1: RED"; exit 1; }
landed_fail() { [ "${MC:-}" = success ] && [ "${REC:-}" = failure ] && [ "${REC_LANDED:-}" = true ] && [ "${MC_STATUS:-}" = FAIL ]; }
case "${DRY_RUN:-}" in
  false)
    if [ -n "${MCO:-}" ]; then
      [[ "$MCO" =~ ^[1-9][0-9]{5,19}$ ]] || red "memcheck-only: bad run id"
      [ "${SEL:-}" = skipped ] || red "memcheck-only (run $MCO): select was not skipped"
      [ "${MC:-}" = success ] && [ "${REC:-}" = success ] && { echo "memcheck-only (run $MCO): memcheck PASS, recheck record landed (nothing promoted)"; exit 0; }
      landed_fail && red "memcheck-only (run $MCO): memcheck FAIL (record landed)"
      red "memcheck-only (run $MCO): memcheck and record did not both run and succeed"
    fi
    [ "${SEL:-}" = success ] && [ "${MC:-}" = success ] && [ "${REC:-}" = success ] && { echo "real run: select, memcheck and record all succeeded"; exit 0; }
    [ "${SEL:-}" = success ] && landed_fail && red "real run: memcheck FAIL (record landed)"
    red "real run: select, memcheck and record did not all run and succeed" ;;
  true) ;;
  *) red "DRY_RUN is neither true nor false" ;;
esac
mode=$(./peaceai/bin/lm-retrain-mode.sh) || red "dry run: bad mode"
n=$(jq -r --arg m "$mode" '.[$m].sweep.lrs | length' "$CFG")
arms=("${SA:-}" "${SB:-}")
[ "$n" = "${#arms[@]}" ] || red "dry run: $n configured sweep arms, ${#arms[@]} summaries"
names=(a b)
for i in "${!arms[@]}"; do
  s="${arms[$i]}"; [ -n "$s" ] || red "dry run: sweep arm ${names[$i]} has an empty summary"
  jq -e 'type == "object"' <<< "$s" > /dev/null 2>&1 || red "dry run: sweep arm ${names[$i]} summary is not parseable"
  r=$(jq -r '.timing.stopReason // "" | tostring' <<< "$s")
  case "$r" in steps | patience) ;; *) red "dry run: sweep arm ${names[$i]} stopped on '$r' (not steps or patience)" ;; esac
done
# The guard has no replay corpus to rebuild the split; the select rule checks every arm against arm a's split (they must agree).
vs=$(jq -c .valSplit <<< "${arms[0]}")
pick=$(python3 peaceai/model/sweep_select.py "$CFG" "$vs" "$mode" "${arms[@]}") || red "dry run: the select rule refused the sweep summaries"
jq -e '.selected.candidate == true and (.selected.arm | type) == "number" and (.selected.step | type) == "number" and .selected.step > 0' <<< "$pick" > /dev/null 2>&1 \
  || red "dry run: the select rule picked no candidate"
a=$(jq -r .selected.arm <<< "$pick")
[[ "$a" =~ ^[0-9]+$ ]] && [ "$a" -lt "${#names[@]}" ] || red "dry run: bad picked arm"
jq -r --arg n "${names[$a]}" '"dry-run pick arm=\($n) (index \(.selected.arm)) lr=\(.selected.lr) step=\(.selected.step) valLoss=\(.selected.valLoss)"' <<< "$pick"
echo "dry run: every sweep arm finished and the select rule picked a candidate"
