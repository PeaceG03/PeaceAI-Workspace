# LM retrain judge gate v1 (judge set v2, report-only)

Status: in force for peace-lm-retrain.yml once Results lm-judge-v2/ has landed (peace-lm-judge-v2.yml). Code:
peaceai/model/judge_gate.py (decision), peaceai/model/judge364.py (scores), peaceai/bin/lm-retrain-judge.sh (items).

## Judge set
- The retrain scores both models on judge set v2: Results `lm-judge-v2/items.json` on main, pinned by content in
  peaceai/model/lm-retrain.json (`eval.judgeItemsSha256` 1deadaae...a2b8, `eval.judgeItemCount` 230). The Results
  commit it was read from is recorded. Before lm-judge-v2/ lands the fetch fails closed ("judge items missing").
- The v1 set (lm-judge/ on notes/lm-judge-eval, `eval.judgeV1`, pinned commit) is read only by peace-lm-judge-v2.yml
  (`JUDGE_SET=v1`), which builds v2 from it. Neither path is ever written by the retrain.
- judge364.py must still reproduce the live model's recorded aggregates (lm-judge-v2/scores-<live>.json). Blocking.

## Gates
- HARD (block the candidate): set C v2 slice identical and pinned; 0 eval overlap; judge scorer reproduces the live
  record; candidate set C v2 bits/byte <= live; candidate trained to the selected step.
- REPORT-ONLY: judge AUC (derived-candidate mean, right- vs wrong-labelled items). Recorded for the live model and the
  candidate, each on:
  - the full set (n 230), `auc_exact` and `auc_ci95`;
  - the non-identity subset (items whose derived program is not `return <param>;`, n 108), `nonidentity.auc_exact` and
    `nonidentity.auc_ci95`.
  The 95% intervals are bootstrap percentiles (2000 draws, seed 7). A report-only AUC can neither block nor pass a
  candidate: the gate result does not depend on it.

## Promote-to-hard rule
The judge AUC may become a hard gate only when BOTH hold:
1. `eval.judgeAucGate` is set to `"hard"` (a reviewed protected change), and
2. the lower 95% bound of the live model's AUC, scored in the same run, is strictly above 0.5 on the full set AND on
   the non-identity subset.
If either fails (including a bound of exactly 0.5, a missing bound or an empty subset), the effective mode is
report-only. When the effective mode is hard, a candidate whose full-set `auc_exact` is below the live model's is
blocked (`judge_auc`).

Eligibility is measured on the live (reference) model, never on the candidate being gated, so a weak candidate cannot
switch the gate off for itself. Today (lm-v1-088073d41dbc on v2): full 0.175 [0.116, 0.237], non-identity 0.434
[0.315, 0.564]; not eligible, so the judge AUC is report-only.

## Open questions (no behaviour change)
- (c) Before any flip to hard: should a candidate also be blocked when its non-identity AUC is below the live model's,
  in addition to the full-set comparison? Today the hard comparison (when eligible) uses the full-set `auc_exact`
  only; the non-identity AUC is used only for eligibility and reporting. Raised by the Auditor after #552; to be
  decided before `eval.judgeAucGate` is ever set to "hard". judge_gate.py and its tests are unchanged.

## Record
`judge: {set, items, itemsSha256, resultsCommit, live, candidate, scorerReproducesLiveRecord, aucGate}` in the run
record (schema peaceai-lm-retrain-record:v3); `aucGate` is judge_gate.py's output (configured, effective,
hardEligible, blocks, both AUCs with intervals for both models).
