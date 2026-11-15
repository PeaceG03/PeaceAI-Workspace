# Pre-registered plan: test-as-spec `CANT_DO_YET_CAP`

This document is frozen before any tuning. It does not change the attempt budget. `SPEC_ATTEMPT_CAP` stays `min(MAX_ATTEMPTS, MAX_CANDIDATES)`, which is 20, for dev and held-out alike. Attempts above 20 receive no `verified_strict` credit until a run is executed exactly as this document says.

## Frozen pins

- Workspace head: `2e094cc1835dbd9b22db61cabf0c075f321391d3` (tree `9537bfeb78da16bc67695abc90063b9c90fe1972`), the squash of #765 on main.
- Core pin, from `peaceai/core-pin.json` at that head: commit `caa7e8a9d835292c33becab4e9a3537ef452217f`, tree `5475c8f1ecd104b6e4cf6dcde60aa618dbfdd3f2`, archive `64e5aa8edfd20e2245e776faafadacd7e4924bbf5e62e4907217ab961bdc259a`.
- Proposer list cap: `MAX_CANDIDATES` = 60. Loop cap: `MAX_ATTEMPTS` = 20. Neither constant is edited by this plan.

No later commit, and no held-out result, may be used to edit this comparison.

## Proposed budget

Raise only the test-as-spec attempt budget from 20 to 60, the proposer's candidate list. The loop's own `MAX_ATTEMPTS` stays 20. A caller's `maxAttempts` still cannot rise above 60.

## Hypothesis

A dev row is `CANT_DO_YET_CAP` on the frozen head when 20 proposals have been tried and `next()` still has another one. The catalog already builds up to 60 candidates. Some of those rows stop because the edit that makes the recorded test and the original suite pass is ranked after attempt 20 and at or before 60. Trying the rest of that list, and not inventing edits, turns some of those rows into diffs. A diff is still not a pass until the behavior grade is `verified_strict` and the gate passes.

## Success metric

The comparison is one replay of the dev test-as-spec rows at the frozen head `2e094cc1835dbd9b22db61cabf0c075f321391d3`, not a count such as "lower than 11". Success is all of:

- at least one dev row whose frozen reason is `CANT_DO_YET_CAP` is no longer that reason;
- every such row is either still a refusal, or a pass whose behavior is `verified_strict` and whose gate passed;
- a row that becomes `verified_test_only` is not a success;
- for dev rows only, the report lists `attempts` and the winning candidate index. Held-out rows do not list those.

## Deadline

Each dev row has the same wall-clock deadline as a practice row on the frozen head. A row that exceeds it is unmeasured. It is not a pass and it is not evidence for a larger budget.

## Held-out

The held-out split is scored once, after the budget change is committed and the single dev comparison has succeeded. It is not used to choose the budget, to reorder candidates, or to edit the proposer. There is no second held-out run.

## Stop rule

The dev metric is computed once. There is no retry and no second dev run if it misses. If that one comparison does not move a frozen `CANT_DO_YET_CAP` row, or any new dev pass is not `verified_strict`, revert the budget to 20 and do not score held-out. If the one held-out score shows fewer `verified_strict` passes than the frozen head, or a held-out pass that is not `verified_strict`, revert the budget to 20 and stop. Do not iterate on either score.
