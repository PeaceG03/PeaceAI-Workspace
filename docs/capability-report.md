# Capability report

Experimental. `credit` is false. This is not an Actions result.

```
tsx peaceai/bin/capability-report.ts [--as-of YYYY-MM-DD] [--replay records.jsonl] [--out <dir>]
```

The headline is how much of the logged Builder job PeaceAI can do himself. 80% is the line for taking over one agent role. A row is a pass only when `--replay` names a fresh execution of that row (`{"seq":N,"status":"pass"|"fail","reason":"..."}`). A row with no record is `unmeasured` and is not a pass. If any in-set row is unmeasured, `realPass` is `unknown`.

A replay line counts only when its `head`, `tree`, and `input` (sha256 of the log text) equal this checkout. A stale head, a different tree, a forged digest, or a missing field stays unmeasured.

The coverage count is the official on-main figure only when `PEACESTOCKS_CLONE` is set and `git merge-base --is-ancestor` accepts each PeaceSTOCKS sha against that clone's HEAD. Without the clone the count is fail-closed (2/187 on this log) and is not labeled official. A checker that accepts every hex sha is not that check. Against PeaceSTOCKS `c617e6340a8ace079ca92480fb002c8bf8beb30f` the ancestry-checked figure on this log, asOf 2026-11-10, is 91/276 (33%). The 2026-10-24 log figure was 91/222 (41.0%). The real-pass sheet quoted as 83/220 is not in this repository.

`PEACESTOCKS_CLONE` checks that a PeaceSTOCKS sha is an ancestor of that clone's HEAD. Unset, those landings fail closed and are not counted as official-able. `WORKSPACE_CLONE` and `PEACEAI_RESULTS_DIR` do the same for a Workspace landing. This command does not edit the log, Results, or credit.

A historical `missing skill` mark stays missing after a later approval (Auditor #216). A gap fix moves the headline only when a new `--replay` record says the row passed.
