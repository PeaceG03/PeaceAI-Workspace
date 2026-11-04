# M191: fail-to-pass site promotion for repair-v2

Spec for the M191 block in `peaceai/lib/editpropose.ts` (`fixEvidence`, `fixSites`, the `baseFailing` prepare input,
and the promotion in `repairProposer().next`). Tests: `m191-cases.ts` (run by `m191-promote.test.ts`; replayed
against mutants by `m191-mutation.test.ts`).

## Why

repair-v2 orders candidates template first, then site, capped at MAX_CANDIDATES = 60, within MAX_ATTEMPTS = 20. M178
demotes sites the tests never notice and M179 anchors an edit that strictly improves. Neither uses the strongest
single-attempt signal: an edit at one site that makes a baseline-failing test pass, even if it also breaks another
test. That is the classic mutation-based fault localization signal (Metallaxis / MUSE: a mutant that flips a failing
test to passing points at the faulty location). The practice-set probe's ATTEMPT_LIMIT reasons showed attempts spread
over helper sites after such a signal. Ranking used failure categories and per-attempt reasons only; no task fix or
reference diff was opened. With M190 the signal is now available for vitest / jest too.

## The mechanism

1. Evidence (`fixEvidence`). For one attempt: codes only TEST_FAIL; the attempt's total equals the baseline's total;
   the baseline's failing names account for every baseline failure (`baseFailing.length === baseline.failing`); the
   attempt's failing names account for every attempt failure; and some baseline failing name occurs fewer times now
   (names counted as a multiset). Anything else is no evidence. Only counts and names are read, never messages.
2. Attribution (`fixSites`). Single-site candidates only (a combined edit does not say which site mattered); each site
   is promoted once.
3. Promotion (repair-v2 only: `opts.v2 === true` and no `opts.order`, so repair-v1 and model-v1 are untouched). On a
   new promotion the queue becomes the promoted sites' untried candidates (fixed template order) followed by the
   rest of the old queue, never re-proposing a tried or deferred candidate, capped at MAX_CANDIDATES.

## Soundness note

- Promotion only reorders what repair-v2 would propose anyway; it adds no new edit, widens no gate, and credits no
  pass. Every proposal still goes through the loop's gates (M175 in-body and the rest) and the real test run.
- Unknown names are never read as "everything passes": an attempt with `failing: []` and failures counted is no
  evidence (fx-known), and missing baseline names promote nothing (fx-base-known). So vitest / jest runs without
  M190 names, mocha and ava behave exactly as before.
- The run stays bounded: the queue is capped and tried candidates are never repeated, so the attempt budget and
  NO_MORE_EDITS behave as before.
- Residual: a flip caused by a test that depends on order or time could promote the wrong site; the cost is ordering
  only (at most the fixed order's attempts are spent elsewhere), never a false pass.

## Admit shapes (none modelled on a practice task or PeaceSTOCKS)

A late-fee module (fee rule plus three helpers) and a thermostat module (boolean rule plus three helpers), run
against an in-process oracle with per-test names; and a scripted three-function module with many candidates (the
cap binds).

## Guards (each a single line tagged `// m191-guard:<id>`, each with a refused near miss and a mutation test)

fx-clean, fx-total, fx-base-known, fx-known, fs-single, fs-once, v2-only, pr-tried, pr-cap.
