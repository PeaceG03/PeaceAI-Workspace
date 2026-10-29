#!/usr/bin/env bash
# Judge v2 promoted pin (Auditor, after #571): restore, from Results, the promoted model named by peaceai/model/judge-v2.json
# promoted, by its verified weights sha256 (never through lm-retrain-live.sh, which restores replayBase), with the run's
# recorded per-item judge v2 scores and the v2 items.
#   DEPLOY_KEY=<a Results key> lm-judge-v2-promoted.sh <dest>
# Refuses (fail closed) unless: judge-v2.json promoted.{version, runId, recordSha256} equal lm-retrain.json promoted (M129);
# lm-retrain-promoted.sh passes (Results latest.json names that version; the run record hashes to its pin and is the PASS
# record for it); at that same Results commit the weights hash to promoted.weightsSha256 (whose first 12 hex digits are
# the version) and equal the record's candidateWeightsSha256, the config names the version with the configured shape,
# judge-model.json hashes to promoted.judgeModelSha256 and is that model's, the record's judge.candidate was scored on the
# pinned v2 items and holds exactly promoted.auc and promoted.auc_ci95, and the target scores file does not exist yet.
# Writes <dest>/model/{config.json,tokenizer.json,weights.npz}, <dest>/scores-recorded.json (the run's judge-model.json),
# <dest>/record-judge.json (the record's judge.candidate), <dest>/promoted.json and <dest>/items.json. Reads Results only.
set -euo pipefail
dest="$1"; cfg=peaceai/model/lm-retrain.json; v2=peaceai/model/judge-v2.json
[ -n "${DEPLOY_KEY:-}" ] || { echo "no Results key: refused (fail closed)"; exit 1; }
j() { jq -r --arg k "$1" '.promoted[$k] // "" | tostring' "$v2"; }
pv=$(j version); run=$(j runId); ws=$(j weightsSha256); rs=$(j recordSha256); js=$(j judgeModelSha256); out=$(jq -r .out "$v2")
[[ "$pv" =~ ^lm-v1-[0-9a-f]{12}$ ]] || { echo "judge-v2 promoted pin: bad version: refused"; exit 1; }
[[ "$run" =~ ^[1-9][0-9]{5,19}$ ]] || { echo "judge-v2 promoted pin: bad runId: refused"; exit 1; }
for x in "$ws" "$rs" "$js"; do [[ "$x" =~ ^[0-9a-f]{64}$ ]] || { echo "judge-v2 promoted pin: bad sha256: refused"; exit 1; }; done
[ "$pv" = "lm-v1-${ws:0:12}" ] || { echo "judge-v2 promoted pin: weightsSha256 is not the version's: refused"; exit 1; }
[ "$out" = lm-judge-v2 ] || { echo "unexpected output path: refused"; exit 1; }
[ "$(j scores)" = "$out/scores-$pv.json" ] || { echo "judge-v2 promoted pin: scores path is not $out/scores-$pv.json: refused"; exit 1; }
[ "$pv" != "$(jq -r .live.version "$v2")" ] || { echo "judge-v2 promoted pin names the live (replay base) model: refused"; exit 1; }
for k in version runId recordSha256; do
  [ "$(j "$k")" = "$(jq -r --arg k "$k" '.promoted[$k] // "" | tostring' "$cfg")" ] || { echo "judge-v2 promoted.$k is not lm-retrain.json promoted.$k: refused"; exit 1; }
done
[ ! -e "$dest" ] || { echo "destination already exists: refused"; exit 1; }; mkdir -p "$dest"
./peaceai/bin/lm-retrain-promoted.sh "$dest/pp"   # latest.json names promoted.version; the record hashes to its pin and holds it
mv "$dest/pp/promoted.json" "$dest/promoted.json"; rm -rf "$dest/pp"
c=$(jq -r .resultsCommit "$dest/promoted.json"); [[ "$c" =~ ^[0-9a-f]{40}$ ]] || { echo "bad Results commit: refused"; exit 1; }
# Everything below is read at the same Results commit the pin check read.
res="$dest/jp-res"; mkdir -p "$res"
git -C "$res" init --quiet; git -C "$res" remote add origin git@github.com:PeaceG03/PeaceAI-Results.git
M="models/lm/$pv"; D="runs/lm-retrain/$run"; T="$out/scores-$pv.json"
git -C "$res" sparse-checkout set --no-cone "/$M/config.json" "/$M/tokenizer.json" "/$M/weights.npz" "/$D/record.json" "/$D/judge-model.json" "/models/lm/latest.json" "/$T"
./peaceai/bin/with-deploy-key.sh git -C "$res" fetch --quiet --depth 1 --filter=blob:none origin "$c" 2>/dev/null || { echo "Results commit could not be fetched: refused"; exit 1; }
./peaceai/bin/with-deploy-key.sh git -C "$res" checkout --quiet --detach FETCH_HEAD 2>/dev/null || { echo "Results checkout failed: refused"; exit 1; }
test "$(git -C "$res" rev-parse HEAD)" = "$c" || { echo "Results checkout is not the pinned-check commit: refused"; exit 1; }
[ ! -e "$res/$T" ] || { echo "$T already exists in Results: refused (never touch an existing scores file)"; exit 1; }
for f in "$M/config.json" "$M/tokenizer.json" "$M/weights.npz" "$D/record.json" "$D/judge-model.json" models/lm/latest.json; do
  [ -f "$res/$f" ] && [ ! -L "$res/$f" ] || { echo "$f missing or not a regular file in Results: refused"; exit 1; }
done
test "$(sha256sum "$res/models/lm/latest.json" | cut -c1-64)" = "$(jq -r .latestJsonSha256 "$dest/promoted.json")" || { echo "latest.json differs from the one checked: refused"; exit 1; }
test "$(sha256sum "$res/$M/weights.npz" | cut -c1-64)" = "$ws" || { echo "promoted weights do not hash to judge-v2.json promoted.weightsSha256: refused"; exit 1; }
R="$res/$D/record.json"
test "$(sha256sum "$R" | cut -c1-64)" = "$rs" || { echo "record does not hash to promoted.recordSha256: refused"; exit 1; }
test "$(jq -r '.candidateWeightsSha256 // ""' "$R")" = "$ws" || { echo "record candidateWeightsSha256 is not promoted.weightsSha256: refused"; exit 1; }
test "$(jq -r .version "$res/$M/config.json")" = "$pv" || { echo "promoted config version mismatch: refused"; exit 1; }
m() { jq -r ".model.$1" "$cfg"; }
test "$(jq -c '[.ctx, .d_model, .n_layer, .n_head, .vocab_size]' "$res/$M/config.json")" = "[$(m ctx),$(m d_model),$(m n_layer),$(m n_head),$(m vocab)]" || { echo "promoted shape differs from the config: refused"; exit 1; }
JM="$res/$D/judge-model.json"
test "$(sha256sum "$JM" | cut -c1-64)" = "$js" || { echo "judge-model.json does not hash to promoted.judgeModelSha256: refused"; exit 1; }
test "$(jq -r .model "$JM")" = "$pv" && test "$(jq -r .summary.model "$JM")" = "$pv" || { echo "judge-model.json is for another model: refused"; exit 1; }
test "$(jq -r .judge.set "$R")" = v2 && test "$(jq -r .judge.itemsSha256 "$R")" = "$(jq -r .items.sha256 "$v2")" || { echo "record judge was not scored on the pinned v2 items: refused"; exit 1; }
test "$(jq -r .judge.candidate.model "$R")" = "$pv" || { echo "record judge.candidate is another model: refused"; exit 1; }
test "$(jq -c '.judge.candidate | [.auc_derived_right_vs_wrong_mean, .auc_ci95]' "$R")" = "$(jq -c '.promoted | [.auc, .auc_ci95]' "$v2")" || { echo "record judge.candidate AUC or CI is not the judge-v2 promoted pin: refused"; exit 1; }
mkdir -p "$dest/model"; cp "$res/$M/config.json" "$res/$M/tokenizer.json" "$res/$M/weights.npz" "$dest/model/"
cp "$JM" "$dest/scores-recorded.json"; jq '.judge.candidate' "$R" > "$dest/record-judge.json"
rm -rf "$res"
./peaceai/bin/lm-retrain-judge.sh "$dest"   # the v2 items on Results main, pinned by sha256 and count (eval.judgeItemsSha256)
test "$(sha256sum "$dest/items.json" | cut -c1-64)" = "$(jq -r .items.sha256 "$v2")" || { echo "v2 items differ from judge-v2.json items.sha256: refused"; exit 1; }
rm -f "$dest/judge-commit.txt"
echo "promoted model $pv restored (weights sha256 verified), recorded judge scores of run $run and $(jq length "$dest/items.json") v2 items fetched"
