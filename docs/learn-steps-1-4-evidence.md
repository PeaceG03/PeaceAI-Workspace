# Learn steps 1-4 evidence

Status: CI not green. This file is not an Actions result.

Review PR: https://github.com/PeaceG03/PeaceAI-Workspace/pull/724
Branch: cursor/learn-practice-pairs-bc03
This note moved out of peaceai/proof/ because that directory is in the never-zone. Adding a file there made m132's exact set fail on Actions.

## Supplied patch

sha256: 3435b27382d062e372cf41b2564eaa0ed1b622d10e9caa15eba169f24a82a40e
Lines: 1336. Six files. Declared git blob hashes, with the trailing newline, matched before edits:
- peaceai/bin/learn-practice.ts a033907
- peaceai/lib/learnpairs.ts cf5fbf1
- peaceai/lib/learnpractice.ts a087ee2
- practice fixture box.ts 5c3a52a
- practice fixture empty.ts f77a86e
- peaceai/test/m224-learn-practice-pairs.test.ts c7d117c
THIRD_PARTY_NOTICES and the m75 notices test were not in that patch and were not recreated.
Applied commit: 6db39ba659c9508d82744d9e2b18fcc5df1d2ff3
Steps 3-4 start: 2914b2120bd52a1855996663fd395d897cd267dd

## Corrected false LEARNED

On the supplied patch, m224 was 5/5 and tsc was clean. The score leaf was LEARNED with held-out 5/5 from two breaks (arithmetic, and off-by-one to 0), copied across input sets.
The correction counts one held-out row per break. LEARNED requires pass rate >= 0.75 on >= 4 independent breaks. That score leaf is not LEARNED. credit stays false. No training and no score wiring.
Held-out sha256 is taken before repair attempts and checked after. A DEV pair needs a second real test run. Target code runs under node --permission. Writes refuse a symlink component.

## Focused tests

On parent a63896ad33361d440c52d033f030a92b8bc6c882 (tree 22042fc73e58fc93fb52355331e737aa9b67067d), before this note:
- tsc -p tsconfig.json --noEmit: exit 0
- m223 + m224 + m75: 18 pass, 0 fail
m75 passed because the made-up shop is generated in the m223 test. Those files are not in the fixture tree.

## Actions on b778a82

ci workflow_dispatch run 42586928471 failed. The tests job had one failure: m132 exact never-zone set, because peaceai/proof/learn-steps-1-4-evidence.md was an extra path. tamper-proof succeeded.
leak-check workflow_dispatch run 42586931811 failed. Two causes:
- m224 lines contained a literal email, which leak-scan flags.
- workflow_dispatch clears the PR author, so scope treats every peaceai/ and test path as a non-owner protected-path change. The PR author is PeaceG03, so a pull_request event is the owner path. That dispatch was not an owner PR.
Readiness files docs/PEACEAI_FINAL_PRODUCT_READINESS.md, packages/core/src/ProductReadiness.ts, and docs/PEACEAI_OVERNIGHT_PROGRESS.md are absent in this repository.

## VM comparison, not an Actions result

On this VM, with the candidate uids set and no sudoers changes, 30 test names in m119, m122, m52, and m202-m207 failed on base 2914b21 and the same names failed on 317ea0b. Causes: missing git objects and OOP_VERIFIER_ACL.
PR 723 Actions tests run 42198330983 had one failure, m75 on the six learn/mini paths (1 of 3521). Those 30 names passed there.
PR 723 builder-log run 42198331005 logged seq 336 PeaceSTOCKS@f31a68c fetch failed. This host got HTTP 200 for f31a68c6d2b6944bd889454780149466f622b5f8. That job was not re-run here.

## Protected files

Against main 86ea415, before this note, the branch diff was only the learn map, tree, practice, pairs, and their tests. Not changed: workflows, package scripts, graders, m75, THIRD_PARTY_NOTICES, verdict, verifier, credit, results, held-out sets, self-zone.ts, selfchange.ts, selfpropose.ts, plandefault.ts.
PR 723 branch gen/batch59-learn was not updated. Drafts 716-722 were not touched.

## Efficiency

Unknown. No matched baseline run of the old route and of learn steps 1-4 exists yet.
What can be measured later, on a temp program that is not a held-out task and not a dev reference diff, with the same minute and attempt caps: independent verified held-out breaks (one per break), verified DEV pairs after the second test run, elapsed time, and attempts used. Repeating one break across inputs does not count as more than one success. Unit tests of the gates are not that measurement.
