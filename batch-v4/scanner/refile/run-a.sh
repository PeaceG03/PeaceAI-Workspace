#!/bin/bash
# Job A only (generate.ts) on each draft; counts only.
set -u
WS=/workspace/v10f/ws; TSX=$WS/node_modules/.bin/tsx
for id in S1 S2 S3 S1orig; do
  d=/workspace/refile/runs/$id; rm -rf $d; mkdir -p $d
  if [ $id = S1orig ]; then python3 -c "import json;t=json.load(open('/workspace/scanfile/batch-v4/scanner/issues/S1.json'));t['number']='refile-S1orig';json.dump(t,open('$d/issue.json','w'))";
  else python3 -c "import json;t=json.load(open('/workspace/refile/notes/batch-v4/scanner/refile/$id.json'));t['number']='refile-$id';json.dump(t,open('$d/issue.json','w'))"; fi
  (cd $WS && PEACEAI_KERNEL_BUNDLE=/workspace/stress/kernel.cjs PEACEAI_OUT_DIR=$d/out PEACEAI_WORKSPACE_DIR=/workspace/refile/stocks PEACEAI_TARGET=PeaceG03/PeaceSTOCKS PEACEAI_CORE_DIR=/workspace/PeaceAI ISSUE_JSON=$d/issue.json GITHUB_OUTPUT=$d/gh-output.txt timeout 600 $TSX peaceai/bin/generate.ts > $d/jobA.log 2>&1; echo "rc=$?" >> $d/jobA.log)
  echo "== $id"; grep -E "^(nl=|learned|rc=)|candidates" $d/jobA.log | head; python3 -c "import json;print('candidates',len(json.load(open('$d/out/summary.json'))['candidates']))" 2>&1; cat $d/gh-output.txt 2>/dev/null
done
