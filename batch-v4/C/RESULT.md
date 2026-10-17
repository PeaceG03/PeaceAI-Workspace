# C live proof: READ_ONLY_OPS (run 2026-10-16, about 22:21 MDT, on main 944ee28 with read-only-ops.json enabled: true)
Box, fresh worktree of main; PEACEAI_OPS_LOG=batch-v4/C/ops.jsonl. Results:
1. recent_runs PeaceAI-Workspace workflow=ci.yml branch=main: ok, 20 items (1-recent_runs.json)
2. run_status run=39002077538 (ci on 944ee28): ok, completed/success (2-run_status.json)
3. failed_jobs run=39000059347: ok, 1 job (tamper-proof, failed step listed) (3-failed_jobs.json)
4. check_runs PeaceSTOCKS sha=07a6f70 (main): ok, 1 check run, success (4-check_runs.json)
5. rerun: refused, op_not_allowlisted, exit 2 (5-refusal-rerun.txt)
6. run_status octocat/Hello-World: refused, repo_not_allowlisted, exit 2 (6-refusal-repo.txt)
ops.jsonl has exactly 6 lines: 4 ok and 2 refused. Each ok line has a GET-only path; refused lines have path null, so no request was made. Nothing was written anywhere.
