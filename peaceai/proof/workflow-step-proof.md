# ADD_WORKFLOW_STEP: grading and live-proof procedure (M19, Auditor #107 changes 4 and 6)

A test that finds the step line in the YAML does not count. A workflow-step rule is proven only by real runs.

## 1. Job B grading (automatic, necessary but not sufficient)
- The candidate diff is only the two added workflow lines (scope.ts; change 3).
- Job B re-reads the step's script from the candidate tree's package.json (re-checked: exactly
  `tsc --noEmit` + plain flags, no pre/post hook; change 2) and runs it as the sandbox user:
  - `afterFix`: the script exits 0 on the candidate tree.
  - `beforeFix`: the same script, same tree, with a deliberately broken type input appended to one file
    the script type-checks (`BROKEN_TYPE_LINE`). It must exit non-zero.
- `COUNTS` only when afterFix = true and beforeFix = false.

## 2. Live proof (manual, recorded on the proof issue; required before the rule's proof is accepted)
1. Push the chosen candidate to a branch `peace-wfproof/issue-N-pass` through a normal PR (never PeaceAI's
   push path; change 5). Record the Actions run id where the new step ran and exited 0.
2. Push the same candidate plus the broken type input to `peace-wfproof/issue-N-broken` (a draft PR that is
   never merged). Record the Actions run id where the same step ran and failed.
3. Both ids go on the proof issue in this form, and the issue stays open until Auditor checks them:

       workflow-step-proof: pass-run=<id> broken-run=<id> step="<name>" sha=<candidate sha>

4. Architect merges the pass PR as a normal PR. No auto-merge; no workflow-write token anywhere in PeaceAI.

## 3. Proof-issue template (change 6)

    Target: PeaceG03/PeaceSTOCKS
    add workflow step NAME to job JOB in .github/workflows/FILE.yml running npm run SCRIPT

    Real need: <why this check is wanted now, with a link to the commit, failure or task that raised it>
    Note (Auditor): this task comes from a real need, not one shaped to match the rule.
    typecheck:lib is an acceptable target.

    workflow-step-proof: pass-run=<filled after run> broken-run=<filled after run>
