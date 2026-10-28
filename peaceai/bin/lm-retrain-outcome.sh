#!/usr/bin/env bash
# M123 retrain outcome (run 40555453905 follow-up; Auditor's design 2). The last job of peace-lm-retrain.yml, always().
# env: DRY_RUN (exactly "true" or "false"), SEL / MC / REC (needs.<job>.result of finetune-eval-land, retrain-memcheck,
# record-memcheck), SA / SB (the sweep arms' summary outputs), CFG, MODE (validated by lm-retrain-mode.sh).
#   real run: exit 0 only if select, memcheck and record all succeeded.
#   dry run:  exit 0 only if every sweep arm left a non-empty, parseable summary that stopped on "steps" or "patience"
#             (train.py's early stop) and peaceai/model/sweep_select.py, the select step's own rule, picks a candidate
#             arm/step; the pick is printed. Anything else exits 1.
set -euo pipefail
echo "outcome dry_run=${DRY_RUN:-} select=${SEL:-} memcheck=${MC:-} record=${REC:-}"
red() { echo "$1: RED"; exit 1; }
case "${DRY_RUN:-}" in
  false)
    [ "${SEL:-}" = success ] && [ "${MC:-}" = success ] && [ "${REC:-}" = success ] || red "real run: select, memcheck and record did not all run and succeed"
    echo "real run: select, memcheck and record all succeeded"; exit 0 ;;
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
