# Learn steps 1-4 evidence

Status: CI PENDING. This file does not record a green Actions result.

Review PR: https://github.com/PeaceG03/PeaceAI-Workspace/pull/724
Branch: cursor/learn-practice-pairs-bc03
Parent of this commit: a63896ad33361d440c52d033f030a92b8bc6c882
Tree of that parent: 22042fc73e58fc93fb52355331e737aa9b67067d
Starting ref for steps 3-4: 2914b2120bd52a1855996663fd395d897cd267dd (PR 723 head)
Main at the comparison before this commit: 86ea41548e09ce7512c80fcd3176d3d0d9d1d367
That main commit is the parent of 2914b21. This branch was 5 commits ahead of main and 0 behind. git merge-tree reported no conflicts.

## Supplied patch

File: peaceai-learn-steps-3-4-plaintext.diff
sha256: 3435b27382d062e372cf41b2564eaa0ed1b622d10e9caa15eba169f24a82a40e
Lines: 1336
Files: 6
Declared git blob hashes, with the trailing newline, all matched before edits:
- peaceai/bin/learn-practice.ts a033907
- peaceai/lib/learnpairs.ts cf5fbf1
- peaceai/lib/learnpractice.ts a087ee2
- peaceai/test/fixtures/learn/practice/src/box.ts 5c3a52a
- peaceai/test/fixtures/learn/practice/src/empty.ts f77a86e
- peaceai/test/m224-learn-practice-pairs.test.ts c7d117c
THIRD_PARTY_NOTICES and peaceai/test/m75-third-party-notices.test.ts were not in that patch and were not recreated.
Applied commit: 6db39ba659c9508d82744d9e2b18fcc5df1d2ff3

## Corrected false LEARNED

On the supplied patch, m224 was 5/5 and tsc was clean. fn:src/box.ts:score was LEARNED with held-out 5/5 from two breaks (arithmetic, and off-by-one to 0), copied across input sets. That is not 4 independent held-outs.
317ea0b counts one held-out row per break. LEARNED requires pass rate >= 0.75 on >= 4 independent breaks. The simple score leaf is not LEARNED. credit stays false. No training and no score wiring.

## Focused tests

Run on the parent tree above, before this document:
- tsc -p tsconfig.json --noEmit: exit 0
- m223 + m224 + m75: 18 pass, 0 fail
m75 passed because the made-up learn/mini shop is generated in the m223 test. The six fixture files are not in the tree. The shop text is original, not a third-party notice.

## Known base VM failures

On this VM, with M202_CAND=peaceai-cand3, M204_CAND=peaceai-cand3, and PEACEAI_VERIFIER_UID=peaceai-verify, and with no sudoers or ACL changes, these 30 test names failed on base 2914b2120bd52a1855996663fd395d897cd267dd and the same 30 names failed on 317ea0b:
m119, m122, m52, m202, m204, m205, m206, and m207 files.
Causes seen: "cannot be read from git", "upload-pack: not our ref", and OOP_VERIFIER_ACL.
PR 723 Actions run 42198330983 had one failure: m75 on the six learn/mini paths (1 of 3521). Those 30 names passed in that Actions job.
PR 723 builder-log run 42198331005: seq 336 PeaceSTOCKS@f31a68c "fetch failed" (thrown fetch, not HTTP 404). This host got HTTP 200 for f31a68c6d2b6944bd889454780149466f622b5f8. That Actions job was not re-run here.

## Protected files

The diff of this branch against 86ea415, before this document, is only:
peaceai/bin/learn.ts
peaceai/bin/learn-practice.ts
peaceai/lib/learnmap.ts
peaceai/lib/learnpairs.ts
peaceai/lib/learnpractice.ts
peaceai/lib/learntree.ts
peaceai/test/m223-learn-map-tree.test.ts
peaceai/test/m224-learn-practice-pairs.test.ts
Not changed: workflows, package.json, package-lock.json, graders, m75, THIRD_PARTY_NOTICES, verdict, verifier, credit, results, held-out sets, self-zone.ts, selfchange.ts, selfpropose.ts, plandefault.ts.
PR 723 branch gen/batch59-learn was not updated. Drafts 716-722 were not touched.

## CI

At the time of this commit, check runs for a63896a were total_count 0. workflow_dispatch of ci.yml (380209543) and leak-check.yml (380209544) returned HTTP 403 Resource not accessible by integration. Those workflows, and builder-log.yml, run on pull_request to main or push to main. This commit is the synchronize push after the PR base is main. It is not a green result.
