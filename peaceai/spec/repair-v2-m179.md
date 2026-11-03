# M179: anchored continuation for repair-v2 (staged repair of multi-part faults)

Spec for the M179 block in `peaceai/lib/editpropose.ts` (`MAX_ANCHOR_MUTS`, `anchorFor`, `composeOnAnchor`,
`Candidate.anchored`, the M179 step in `repairProposer().next`, and two one-line hooks in M178's code). Tests:
`m179-cases.ts` (run by `m179-anchor.test.ts`; the pure cases are replayed against mutants by `m179-mutation.test.ts`).

## Why

Many real fixes touch more than one place (multi-hunk / multi-location patches are a large share of real bug fixes in
the APR literature, e.g. the Defects4J dissection by Sobreira et al., 2018, and multi-hunk repair such as Hercules,
2019). repair-v2 had one way to reach a two-part fix: the improved-pair step combines two candidates that EACH raised
the passing count on their own. That covers independent faults only. It cannot reach a MASKED fault: when a test runs
through fault 1 before it reaches fault 2, fixing fault 2 alone changes no test result, so that part never "improves"
and is never paired; and every candidate after a partial fix is tried on the original code, throwing the partial
progress away. This is the classic staged / hill-climbing repair idea: keep a partial fix and search on top of it.

What was looked at: the repair-v2 order, the improved-pair step, M178's evidence, the loop's feedback record, and the
general APR literature. No dev-split task, dev-task diagnosis, reference diff or PeaceSTOCKS code was used to choose,
shape or test this; the fixtures are synthetic (a rectangle class, a mean with its centered values in two modules).

## The mechanism (repair-v2 only: `opts.v2 === true` and no `opts.order`)

1. Anchor (`anchorFor`): the tried candidate with the highest passing count ABOVE the baseline's, among results with
   no code but TEST_FAIL (`an-clean`) and the baseline's total (`an-total`; no counts or no baseline also stop here),
   carrying fewer than MAX_ANCHOR_MUTS = 3 mutations (`an-room`), whose failing test names are all among the
   baseline's failing names (`an-names`, batch 19 per Auditor's #680 review, like M178's `ev-names`: a result that
   raises the count while breaking a test that passed before is no anchor; vitest / jest give no names, so for them
   this check is vacuous and the counts decide as before). Ties keep the earliest (`an-improves`: strictly above).
   These are the counts and names the loop already gives; no message text, no new channel.
2. Composition (`composeOnAnchor`): a candidate's mutations applied together with the anchor's, on the original
   files, marked `anchored`. Refused when the candidate overlaps the anchor (`co-overlap`: it changes what the anchor
   changed, so it is tried alone instead), when the total would exceed MAX_ANCHOR_MUTS (`co-cap`), when the result does
   not parse (`co-valid`, via `candidateFor`), or when that composition was already proposed (`co-seen`).
3. Order (`repairProposer().next`, after the improved-pair step, which keeps priority and is unchanged): when a NEW
   anchor appears, every candidate tried so far is queued to be retried on top of it, in the order it was tried (an
   edit the tests did not notice on the original code may be masked by the anchor's fault, so inert ones are included);
   then each next queued candidate is proposed composed on the anchor, and its standalone form is deferred to the end
   (`df-defer`, `df-tail`: reorder, not drop). A composed result that scores higher becomes the next anchor (greedy
   hill climbing, bounded by MAX_ANCHOR_MUTS). With no anchor nothing changes.
4. M178 hooks: a composed candidate's result is no site evidence (`an-no-evidence`: its counts are relative to the
   anchor, not to the original code), and an M178 rebuild does not bring a deferred candidate back into the queue
   (`rb-deferred`, so nothing is proposed twice).

## Candidate order and box behavior on existing cases

The order changes only after a clean partial improvement, and only for repair-v2. Up to and including the anchor the
proposals are the fixed order (asserted); "no anchor, no change" asserts the proposals are exactly the fixed order
when nothing improves. The existing repair-v2 cases (m168, m172, m173, m176, m177, m178) pass unchanged in the focused
runs and in the full suite (PR body). repair-v1 and model-v1 keep the fixed order on the same evidence (asserted).

## Soundness note

- The step only reorders and composes candidates the proposer already builds: every mutation in a composed candidate
  is one of the static list's own (template-built from text in the file), applied to the original files; nothing new
  is written. Validation is unchanged: the loop's M175 gate (`editScopeProblem`) re-classifies every proposal, composed
  ones included, before anything runs; EDIT_NEW_WORDS, the gate classes and the row checks are untouched. Every
  proposal of both admits is checked `in-body`, and the end-to-end PASS row records `editScope: "in-body"`.
- The evidence cannot make a candidate pass: it only decides which candidate is proposed next; the team's tests (graded
  by the M173 report protocol) decide. The counts come from the trusted runner; a candidate adds no channel.
- A misleading anchor (a partial improvement that is not part of the real fix) costs attempts, not reach: the
  standalone forms of the composed candidates are tried after the queue (`df-tail`, tested with a scripted misleading
  anchor). Within the MAX_ATTEMPTS = 20 budget a misleading anchor can push a standalone fix out of reach; that is the
  cost, stated, not fixed. The improved-pair step keeps priority, so independent two-part fixes are reached as before.
- Bounded: at most MAX_ANCHOR_MUTS mutations per proposal; composed and deferred candidates come from the capped
  (MAX_CANDIDATES) queue and the tried list; no proposal repeats (asserted on all admits and the rebuild case).
- vitest / jest give `failing: []`; the anchor reads counts only, so it works the same for every runner.

## Tests

- Two admits on unrelated shapes: RECT (one class: `fits` calls `area`; area divides instead of multiplying, fits uses
  `<` for `<=`) and MEANS (two modules: `centered` imports `mean`; mean multiplies by the length, centered subtracts
  the wrong way round). Each asserts PASS within MAX_ATTEMPTS, that the passing edit is two static candidates composed,
  that one part alone raises no count (so neither a single candidate nor the improved-pair step can be the fix) and
  the other alone is a clean partial fix, no repeated proposal, and every proposal in-body under the M175 gate.
- Order: fixed order up to the anchor, every later proposal carries the anchor's edit; no anchor, no change.
- Near misses per guard: at or below baseline / ties (`an-improves`), no baseline, timeout / load / leftovers
  (`an-clean`), a higher count with a failing name outside the baseline's (`an-names`; a subset and no names are still
  anchors), another total or no counts (`an-total`), a full candidate (`an-room`), overlap, cap, parse, seen
  (`co-*`), M178 evidence from a composed result (`an-no-evidence`), repair-v1 / model-v1 / v2 with `order`
  (`an-v2-only`), a scripted misleading anchor whose deferred standalone form is the fix (`df-defer`, `df-tail`), and a
  scripted M178 rebuild after an anchor (`rb-deferred`: no repeat).
- End to end through the real loop (candidate uid M179_CAND, node:test tests, MAX_ATTEMPTS 20): RECT is a valid PASS
  row with `editScope: "in-body"`. Like m178's, the e2e case may run up to E2E_TRIES = 3 times under shared-uid load.
- Mutation: each of the 14 tagged `m179-guard` lines (13 in batch 18, + `an-names` in batch 19) deleted in turn fails an assertion (not a crash).

## Claims

None about dev tasks or readiness. CI dev runs use repair-v1 / model-v1 / rules-v1; this changes repair-v2 only, and
box runs never count. Readiness statuses are unchanged.

## Batch 18 items from Auditor's #678 review (not part of M179's proposer change)

- `m178-demote.test.ts`: the loop end-to-end case (needsCand, with a candidate uid) may run up to E2E_TRIES = 3 times
  (`withE2eRetry` in `m178-cases.ts`), like m174-mutation's control; a pure case is never retried, and without a uid
  nothing is retried. Its run timeout already scales with E2E_LOAD. A test checks the retry runs a failing case exactly
  E2E_TRIES times and then fails.
- `m178-cases.ts` line 26 comment: the generic "peaceai-cand3 on the box" wording replaced by "the box suite sets it
  explicitly".
