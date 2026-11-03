# M178: inert-site demotion for repair-v2 (mutation-based fault localization)

Spec for the M178 block in `peaceai/lib/editpropose.ts` (`INERT_AFTER`, `siteEvidence`, `siteDemotions`, the `skip`
parameter of `repairCandidates`, and the rebuild in `repairProposer().next`). Tests: `m178-cases.ts` (run by
`m178-demote.test.ts`; the pure cases are replayed against mutants by `m178-mutation.test.ts`).

## Why

repair-v2 orders its candidates template first, then site, then position, capped at MAX_CANDIDATES = 60, and the loop
tries at most MAX_ATTEMPTS = 20. When the request or the failing tests locate several functions but the tests only
execute one of them, the first 20 attempts are spread across sites the tests never run, and the right edit at the
executed site sits past attempt 20. Every attempt already returns evidence the proposer ignored: an edit the test suite
does not notice at all (same counts, same failing names) is an edit to code the tests do not reach. This is the
general mutation-based fault localization idea (Metallaxis / MUSE: a location whose mutants never change any test
outcome is unlikely to hold the fault) applied to the proposer's own attempts, at no extra test cost.

What was looked at: the repair-v2 ordering, the loop's feedback record, and the general MBFL literature. No dev-split
task, dev-task diagnosis, reference diff or PeaceSTOCKS code was used to choose, shape or test this; the fixtures are
synthetic (pipes / walls / sheets with a `thickness` method; a shopping cart module).

## The mechanism

1. Evidence (`siteEvidence`). For an attempt with a baseline, a test count, and no code other than TEST_FAIL: INERT when
   total, passedByPeaceAI and the sorted failing test names all equal the baseline's; LIVE when any differs. Anything
   else (no baseline, no counts, a timeout, a load failure, a refusal, a gate code) is no evidence. Only counts and
   names are read, never a message, so a candidate's output text cannot steer it.
2. Attribution (`siteDemotions`). Only single-site candidates count (a combined candidate does not say which site
   mattered). A site is demoted when it has at least INERT_AFTER = 2 inert results, no live result, is not already
   demoted, and SOME other site has a live result. A suite that notices nothing demotes nothing.
3. Rebuild (repair-v2 only: `opts.v2 === true` and no `opts.order`, so repair-v1 and model-v1 are untouched). On a new
   demotion the queue becomes: the candidates of the non-demoted sites in the same static order (`repairCandidates`
   with `skip`; site numbers stay the located ones; already-tried keys skipped), then the remaining queued candidates
   of the demoted sites, in their old order. Capped at MAX_CANDIDATES. Nothing is removed from consideration that the
   cap would not already have removed; demoted candidates move behind, they are not dropped from the rebuilt list
   unless the cap is reached.

## Candidate order and box behavior on existing cases

The first queue is byte-identical to the pre-M178 queue: the rebuild runs only after a demotion, and a demotion needs
two inert results at one site plus a live result elsewhere. The case "no evidence, no change" asserts the proposals are
exactly the fixed order when no site is ever live. Existing repair-v2 e2e cases are solved before any demotion can
fire or have a single site; their attempt counts are unchanged in the focused runs (m168, m172, m173, m176, m177) and in
the full suite (PR body). This is a deliberate order change only after evidence, and only for repair-v2.

## Soundness note

- Demotion is a reorder, not a filter: a demoted site's candidates stay in the queue behind the live sites (up to the
  cap). If the fault is at a site whose mutants were all equivalent (an INERT result although the code runs), the fix
  is reached later, not never, unless the 60 cap or the 20-attempt budget runs out first; that is the cost.
- The evidence cannot make a candidate pass: it changes only which existing candidate is proposed next. Validation,
  the M175 gate (every proposal is still checked before each attempt), EDIT_NEW_WORDS and the gate classes are
  untouched.
- The evidence is only counts and test names the loop already computes from the trusted runner; a candidate cannot
  add a channel. vitest / jest give `failing: []`, so for them names are compared as empty on both sides and the
  counts carry the signal.
- MBFL needs the tests to run through the faulty site; when no site is live nothing changes (fail safe to the old
  order).

## Tests

- Two admits on unrelated shapes (PIPES: one method name in three classes, tests exercise one; CARTS: a request naming
  three functions plus module constants, tests exercise one). Each asserts the winning candidate's static queue index
  is >= 20 or absent (unreachable before M178), the winning template, no repeated proposal, and every proposal is
  in-body under the M175 gate.
- Near misses per condition: no baseline, no counts, a non-TEST_FAIL code, changed counts, changed names, combined
  candidates, one inert result, a live result at the same site, no live site anywhere, already demoted, repair-v1 and
  model-v1 (`order`) keep the fixed order.
- Rebuild: no repeats, the demoted site is skipped right after demotion, <= MAX_CANDIDATES proposals after the last
  demotion.
- End to end through the real loop (candidate peaceai-cand3, vitest-style tests, MAX_ATTEMPTS 20): PASS, in-body.
- Mutation: each of the 14 tagged `m178-guard` lines deleted in turn fails an assertion (not a crash).

## Claims

None about dev tasks or readiness. CI dev runs use v1 / model-v1 / rules-v1; this changes repair-v2 only. Readiness
statuses are unchanged.

## Batch 17 steer items (not part of M178's proposer change)

- m96 exemption (`secretsFreeBuild` in `m96-protect-tool-closure.test.ts`): also refused when a top-level `env:` or
  `defaults:` block of peace-lb-chain2.yml (inherited by every job) carries secrets, vars, github.token or a TOKEN, and
  when the c2-corpus job reads secrets without a dot (`toJSON(secrets)`, `secrets['X']`). Workflow-text mutants for each,
  near misses (plain top-level env / defaults keep the exemption). The workflow file is unchanged (m9 pin).
- `peaceai/bin/lb-chain2-run.sh` (protected): `set -euo pipefail`; a failed heldout_v2 evaluation now exits 4 with
  LB_C2_EVAL_V2_FAILED as the last line instead of exiting 0. In peace-lb-chain2.yml the R2 save copy, the row and the
  Results row follow run.sh without `always()`, so they are skipped on that day. Before, the save was copied to R2 and
  then `lb_chain2.py row` failed on the missing eval-v2.json (LB_C2_TRAIN_ERROR), leaving an orphan save with no row.
  Tested in `m178-chain2-failfast.test.ts` (ok day, failed eval, untrained day, cycle failure; 4 mutants).
- The 18 test fixtures that fell back to the `peaceai-cand` user when their M1xx_CAND variable was unset now fall back
  to "" (fail closed: CAND_UID_* refusal or skip, as m177-cases.ts does). The box suite sets every M1xx_CAND to
  peaceai-cand3 explicitly. m177-cases.ts line 26 comment: "M176" corrected to "M177".
