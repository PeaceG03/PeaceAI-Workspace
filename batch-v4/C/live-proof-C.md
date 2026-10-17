# C live proof (draft). Run on the box after #333 and its approval PR merge. Read-only; nothing is filed or posted.
cd <fresh Workspace clone at main>
export PEACEAI_OPS_LOG=/workspace/batch-skills/proofs/v4/C/ops.jsonl
npx tsx peaceai/bin/read-only-ops.ts recent_runs PeaceG03/PeaceAI-Workspace workflow=ci.yml branch=main
npx tsx peaceai/bin/read-only-ops.ts run_status PeaceG03/PeaceAI-Workspace run=<id from above>
npx tsx peaceai/bin/read-only-ops.ts failed_jobs PeaceG03/PeaceAI-Workspace run=<a failed run id, if any>
npx tsx peaceai/bin/read-only-ops.ts check_runs PeaceG03/PeaceSTOCKS sha=<PeaceSTOCKS main sha>
# refusals (exit 2, logged): 
npx tsx peaceai/bin/read-only-ops.ts rerun PeaceG03/PeaceAI-Workspace run=1        # op_not_allowlisted
npx tsx peaceai/bin/read-only-ops.ts run_status PeaceG03/PeaceAI-Results run=1     # repo_not_allowlisted
# expect: ops.jsonl has one line per command (4 ok, 2 refused); no write calls anywhere.
