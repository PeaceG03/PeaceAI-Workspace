#!/usr/bin/env bash
# M119 (LM retrain): restore the live model and the judge items from Results, checked, in every job that needs them.
#   DEPLOY_KEY=<a Results key> lm-retrain-live.sh <dest>
# Writes <dest>/live/{config.json,tokenizer.json,weights.npz}, <dest>/items.json and <dest>/scores-live-recorded.json (the
# live model's recorded judge aggregates, which judge364.py must reproduce in the run). Refuses unless the configured live
# version is latest.json, its weights hash to its version, its shape equals the config and the judge item count is the
# pinned one. latest.json is only read. Counts only on stdout.
set -euo pipefail
dest="$1"; cfg=peaceai/model/lm-retrain.json
[ -n "${DEPLOY_KEY:-}" ] || { echo "no Results key: refused (fail closed)"; exit 1; }
live=$(jq -r .live.version "$cfg"); [[ "$live" =~ ^lm-v1-[0-9a-f]{12}$ ]] || { echo "bad live version"; exit 1; }
res="$dest/res"; rm -rf "$res"; mkdir -p "$dest"
./peaceai/bin/with-deploy-key.sh git clone --quiet --depth 1 --filter=blob:none --sparse git@github.com:PeaceG03/PeaceAI-Results.git "$res"
./peaceai/bin/with-deploy-key.sh git -C "$res" sparse-checkout set --no-cone /lm-judge/items.json "/lm-judge/scores-$live.json" /models/lm/latest.json "/models/lm/$live/"
./peaceai/bin/with-deploy-key.sh git -C "$res" checkout --quiet
test "$(jq -r .version "$res/models/lm/latest.json")" = "$live" || { echo "the configured live model is not latest.json: refused"; exit 1; }
L="$res/models/lm/$live"
if [ -n "$(find "$L" -type l)" ]; then echo "refused: symlink in model dir"; exit 1; fi
test "lm-v1-$(sha256sum "$L/weights.npz" | cut -c1-12)" = "$live" || { echo "live weights do not hash to their version: refused"; exit 1; }
test "$(jq -r .version "$L/config.json")" = "$live" || { echo "live config version mismatch: refused"; exit 1; }
m() { jq -r ".model.$1" "$cfg"; }
test "$(jq -c '[.ctx, .d_model, .n_layer, .n_head, .vocab_size]' "$L/config.json")" = "[$(m ctx),$(m d_model),$(m n_layer),$(m n_head),$(m vocab)]" || { echo "live shape differs from the config: refused"; exit 1; }
test "$(jq length "$res/lm-judge/items.json")" = "$(jq -r .eval.judgeItemCount "$cfg")" || { echo "judge item count changed: refused"; exit 1; }
mkdir -p "$dest/live"; cp "$L"/config.json "$L"/tokenizer.json "$L"/weights.npz "$dest/live/"
cp "$res/lm-judge/items.json" "$dest/items.json"; cp "$res/lm-judge/scores-$live.json" "$dest/scores-live-recorded.json"; rm -rf "$res"
echo "live model $live restored (weights sha matches its version)"
