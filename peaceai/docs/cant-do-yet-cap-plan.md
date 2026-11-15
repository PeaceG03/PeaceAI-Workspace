# Pre-registered plan: test-as-spec `CANT_DO_YET_CAP`

This file does not change the attempt budget. `SPEC_ATTEMPT_CAP` stays `min(MAX_ATTEMPTS, MAX_CANDIDATES)`, which is 20, for dev and held-out alike.

## Proposed budget

Raise the test-as-spec attempt budget from 20 to the proposer's candidate list, `MAX_CANDIDATES` (60). The loop's own `MAX_ATTEMPTS` stays 20. A caller's `maxAttempts` still cannot rise above the new cap.

## Hypothesis

A dev row is `CANT_DO_YET_CAP` when 20 proposals have been tried and `next()` still has another one. The repair catalog already builds up to 60 candidates. Some of the 11 dev rows stop because the edit that makes the recorded test and the original suite pass is ranked after attempt 20 and at or before 60. Trying the rest of that list, and not inventing edits, turns some of those rows into diffs. A diff is still not a pass until the behavior grade is `verified_strict` and the gate passes.

## Success metric

Score the dev split only, before any held-out run. Success is all of:

- the number of test-as-spec dev rows with reason `CANT_DO_YET_CAP` is lower than 11;
- every dev row that leaves `CANT_DO_YET_CAP` is either still a refusal, or a pass whose behavior is `verified_strict` and whose gate passed;
- a row that becomes `verified_test_only` is not counted as a success.

## Held-out

The held-out split is scored once, after the budget change is committed and the dev metric above has succeeded. It is not used to choose the budget, to reorder candidates, or to edit the proposer. There is no second held-out run.

## Stop rule

If the dev `CANT_DO_YET_CAP` count does not fall, or any new dev pass is not `verified_strict`, revert the budget to 20 and do not score held-out. If the one held-out score shows fewer `verified_strict` passes than before the change, or a held-out pass that is not `verified_strict`, revert the budget to 20 and stop. Do not iterate on that score.
