#!/usr/bin/env bash
# Files the batch-v5 tasks on PeaceAI-Workspace as Peace's tasks (label peace-task -> peace-intake queues them).
# Run ONLY after Peace OKs filing. Not near 05:30Z / 09:30Z.
set -euo pipefail
cd /workspace/batch-v5
for f in tenMinPairManifestKey isIdleScannerRun countGappedPlannedFetches countOrphanFetches shouldDispatchHeal planCancelDispatchedRun planUpgraded parseFetchIdentityKey; do
  t=$(jq -r .title issues/$f.json); jq -r .body issues/$f.json > /tmp/b5-$f.md
  url=$(gh issue create -R PeaceG03/PeaceAI-Workspace --title "$t" --body-file /tmp/b5-$f.md --label peace-task)
  echo "$f $url" | tee -a filed.txt
done
