#!/usr/bin/env bash
# LM retrain replay: in every job after corpus-gate, the rebuilt replay corpus and its overlap proof must be the ones
# corpus-gate proved before training (same replay manifest sha256; same train / val doc-list, set C list and judge
# items shas; proof ok). Refuses on any difference.
#   lm-retrain-replay-check.sh <work> <replay manifest sha256> <trainIds,valIds,setcShaList,judgeItems shas>
set -euo pipefail
work="$1"; want="$2"; wantp="$3"
[[ "$want" =~ ^[0-9a-f]{64}$ && "$wantp" =~ ^[0-9a-f]{64}(,[0-9a-f]{64}){3}$ ]] || { echo "bad corpus-gate replay outputs: refused"; exit 1; }
test "$(sha256sum "$work/replay/manifest.jsonl" | cut -c1-64)" = "$want" || { echo "rebuilt replay corpus differs from the proven one: refused"; exit 1; }
test "$(jq -r .ok "$work/replay-proof.json")" = true || { echo "replay overlap proof failed: refused"; exit 1; }
test "$(jq -r '[.trainIdsSha256, .valIdsSha256, .setcShaListSha256, .judgeItemsSha256] | join(",")' "$work/replay-proof.json")" = "$wantp" || { echo "replay proof differs from corpus-gate's: refused"; exit 1; }
echo "replay corpus and overlap proof match corpus-gate"
