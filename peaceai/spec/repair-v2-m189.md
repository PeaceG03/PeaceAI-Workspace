# M189 (batch 23): repair-v2 candidate cap keeps slots for reach sites

## Problem (Auditor's batch-22 note)

`repairCandidates` sorts every template mutation by template rank, then site, then position, and stops at
`MAX_CANDIDATES` (60). A located function with many operators can fill all 60 slots on its own, so a reach site
(tier >= 4: M182 class members, M184 / M186 barrel and default re-exports) gets no candidate at all. The synthetic
probe in `m189-cases.ts` shows this: before M189 a 31-line scoring function plus a class member yields 60 candidates,
0 of them at the member.

## Rule (repair-v2 only)

The walk order and the dedupe are unchanged. With `v2` set, the walk collects candidates on two sides, up to 60 each:
located (site tier < `REACH_TIER` = 4) and reach (the rest). The reach side keeps what fits after the located side,
and at least `REACH_RESERVED` = 12 (or all it has, if fewer); the located side keeps the rest of the 60. The kept
candidates are emitted in the walk's order, and only their keys are added to `seen`.

Unchanged:
- repair-v1, so model-v1's scoring list (`modelscore.ts` calls `repairCandidates(sites, files)`) is byte-identical;
- any list where the cap does not bind, or where there is no reach site (asserted against the plain walk);
- the cap itself (60), the template set, the site tiers, the M178 rebuild (it calls the same function with its tried
  keys as `seen`, which are skipped on both sides).

## Soundness

Only which candidates fill the existing 60 slots changes; no new edit kind, file, or site is introduced, and each
candidate still goes through the same M175 gate and test oracle. The worst case is that up to 12 located candidates
late in the template order (which earlier batches would have tried) are replaced by reach candidates.

## Tests

- `peaceai/test/m189-reach.test.ts`: 3 cases on two synthetic shapes (scoring function + class member; pricing
  function + barrel-resolved rounding helper): reservation, order, unchanged lists. Pure, no candidate uid.
- `peaceai/test/m189-mutation.test.ts`: guards `v2-only`, `reserve`, `order`; deleting each makes a case fail.

No task fixes were used: the rule and both test shapes are synthetic, and nothing here is modeled on a dev task, a
task's fix or a reference diff (Auditor's optional item on #687; batch 26).
