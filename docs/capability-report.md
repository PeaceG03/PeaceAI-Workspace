# Capability report

Experimental. `credit` is false. This is not an Actions result.

```
tsx peaceai/bin/capability-report.ts [--as-of YYYY-MM-DD] [--replay records.jsonl] [--out <dir>]
```

The headline is how much of the logged Builder job PeaceAI can do himself. 80% is the line for taking over one agent role. A row is a pass only when `--replay` names a fresh execution of that row (`{"seq":N,"status":"pass"|"fail","reason":"..."}`). A row with no record is `unmeasured` and is not a pass. If any in-set row is unmeasured, `realPass` is `unknown`.

The official `coverage.ts` count is printed next to it. It is the live-proven skill count (Builder rows whose mark was already PeaceAI-able, plus PeaceAI real landings). It is not a fresh execution. On 2026-10-24 that official figure was 91/222 (41.0%). The real-pass figure quoted from that day was 83/220 (37.7%). The per-row sheet for those 83 passes is not in this repository.

`PEACESTOCKS_CLONE` checks that a PeaceSTOCKS sha is an ancestor of that clone's HEAD. Unset, those landings fail closed and are not counted as official-able. `WORKSPACE_CLONE` and `PEACEAI_RESULTS_DIR` do the same for a Workspace landing. This command does not edit the log, Results, or credit.

A historical `missing skill` mark stays missing after a later approval (Auditor #216). A gap fix moves the headline only when a new `--replay` record says the row passed.
