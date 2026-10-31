#!/usr/bin/env bash
# lb-train v1 first run (Auditor ruling after #654): rebuilds the cleared lb-clean corpus in-run, ported from the
# box recipe that produced the cleared pins. Usage: lb-corpus-rebuild.sh <empty dir>   (needs git, jq, node 22, and
# anonymous network to github.com and registry.npmjs.org; no key, nothing private).
# Builds with the tools of PeaceAI-Workspace at the pinned commit b149d9b (fetched by full sha, HEAD checked), the
# same ext-fetch / ext-manifest-check pin as peace-lm-train.yml, the public task-set refs, and lb-clean with
# peaceai/model/lb-hidden-drop-hashes.txt (which must be byte-identical to this checkout's copy and to the pinned
# sha256). Output: <dir>/out/{docs.jsonl,manifest.jsonl,fingerprint.json}; lb_run.py pins then refuses unless all three
# pins equal lb-train.json firstRun.corpus. Logs: shas and counts only.
set -euo pipefail
WS_COMMIT=b149d9bea430d45792470f0e32657032748af717
DROP_SHA=ecc97adfde53f4307fadfd93ee7f4c5cacb29c24665a37ba54becc87a5b1dc0a
PIN=8458eac61cc414128e98eedb6c3b3ad9c50813e62ab680f5a9ef9d909ccfc231
HERE=$(cd "$(dirname "$0")/../.." && pwd)
D=$(realpath -m "${1:?usage: lb-corpus-rebuild.sh <empty dir>}")
if [ -e "$D" ] && [ -n "$(ls -A "$D")" ]; then echo "LB_REBUILD_DIR_NOT_EMPTY"; exit 1; fi
mkdir -p "$D"; cd "$D"
git init -q ws
git -C ws fetch -q --depth 1 https://github.com/PeaceG03/PeaceAI-Workspace "$WS_COMMIT"
git -C ws -c advice.detachedHead=false checkout -q FETCH_HEAD
test "$(git -C ws rev-parse HEAD)" = "$WS_COMMIT" || { echo "LB_REBUILD_COMMIT_MISMATCH"; exit 1; }
DROP=ws/peaceai/model/lb-hidden-drop-hashes.txt
test "$(sha256sum < "$DROP" | cut -d' ' -f1)" = "$DROP_SHA" || { echo "LB_REBUILD_DROP_MISMATCH"; exit 1; }
cmp -s "$DROP" "$HERE/peaceai/model/lb-hidden-drop-hashes.txt" || { echo "LB_REBUILD_DROP_MISMATCH"; exit 1; }
(cd ws && npm ci --ignore-scripts --no-audit --no-fund --loglevel=error)
TSX=ws/node_modules/.bin/tsx; EX=ws/peaceai/model/nl-pairs-exclusions-hidden-hashes.txt
# 1. the pinned input corpus (same manifest pin as the M37 job)
(cd ws && ./node_modules/.bin/tsx peaceai/bin/ext-fetch.ts "$D/src" "$D/corpus" --manifest-sha "$PIN")
(cd ws && ./node_modules/.bin/tsx peaceai/bin/ext-manifest-check.ts "$D/corpus" pretrain --manifest-sha "$PIN")
rm -rf "$D/src"
# 2. public task-set refs: each task of tasks-public-v1.json at its pinned commit -> trees/<id>/
mkdir -p trees
jq -r '.tasks[] | "\(.id) \(.repo) \(.commit)"' ws/peaceai/plan/tasks-public-v1.json | while read -r id repo commit; do
  [[ "$id" =~ ^[A-Za-z0-9._-]+$ && "$id" != . && "$id" != .. && "$repo" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ && "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "LB_REBUILD_BAD_TASK_ROW"; exit 1; }
  git init -q "trees/$id"; git -C "trees/$id" fetch -q --depth 1 "https://github.com/$repo.git" "$commit"
  git -C "trees/$id" -c advice.detachedHead=false checkout -q FETCH_HEAD
  test "$(git -C "trees/$id" rev-parse HEAD)" = "$commit" || { echo "LB_REBUILD_TASK_COMMIT_MISMATCH"; exit 1; }
done
echo "task trees=$(find trees -mindepth 1 -maxdepth 1 -type d | wc -l)"
"$TSX" ws/peaceai/bin/lb-clean.ts --build-refs --tasks ws/peaceai/plan/tasks-public-v1.json --trees trees --out refs --exclusions "$EX" > /dev/null
# 3. clean with the hidden drop hashes
"$TSX" ws/peaceai/bin/lb-clean.ts --in corpus --out out --refs refs --exclusions "$EX" --drop-hashes "$DROP" > /dev/null
sha256sum corpus/docs.jsonl corpus/manifest.jsonl refs/docs.jsonl refs/manifest.jsonl out/docs.jsonl out/manifest.jsonl
echo "fingerprint $(jq -r .fingerprint out/fingerprint.json)"
jq -c '{docsOut, taskset_hidden_dup: .drops.taskset_hidden_dup, dropHashes}' out/clean-report.json || true
rm -rf trees refs corpus
