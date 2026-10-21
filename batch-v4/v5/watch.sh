#!/usr/bin/env bash
# waits until all of #390-#397 carry peaceai:done (or 60 min)
for i in $(seq 1 120); do
  n=0; line=""
  for k in 390 391 392 393 394 395 396 397; do
    l=$(gh issue view $k -R PeaceG03/PeaceAI-Workspace --json labels --jq '[.labels[].name]|join(",")')
    line="$line $k:[$l]"; [[ $l == *peaceai:done* ]] && n=$((n+1))
  done
  echo "$(date +%H:%M) done=$n $line"
  [ $n -eq 8 ] && echo ALLDONE && exit 0
  sleep 30
done; echo TIMEOUT
