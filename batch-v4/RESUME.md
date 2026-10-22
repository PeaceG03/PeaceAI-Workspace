# Big batch v4 RESUME (recreated 2026-10-16 ~21:10 MDT after a second box restore wiped the first copy)

Rules: extend existing architecture; PRs + 1-commit approval PRs (never update-branch them); don't merge; never /verdict or
/approve-rule; push as PeaceG03 noreply; no force-push/--no-verify; never print core text; no training/paid compute.
Proofs drafted here (A = landing, B = refusal), filed only after approvals merge.

## Box state
- Two restores so far. Old dirs moved aside (never deleted): *.broken-20261017b, *.partial-20261017.
- After a restore: `gh auth setup-git`; re-clone into a temp dir then mv into place (restore can repopulate paths lazily);
  `npm ci`; `bash peaceai/bin/install-pre-push.sh --template /workspace/PeaceAI` and without --template; set git user.
- Box-env failure to ignore: peaceai/test/m48-setc-tasks.test.ts "rebuilding from pinned snapshots" fails on main too (/workspace/ext; skipped in CI).

## A SELF_CHANGE stage 1 - remote branch m72/self-zone-stage1 (head c666381), approval branch m72/self-zone-enable
- self-zone.ts (extra protected list + safe zone + protectedDigest + selfZoneSelfCheck), helpers text.ts/dates.ts, doc,
  target.ts selfZone, learned.ts selfZoneRefusal (before denyPatterns), test-candidates.ts digest x2, tamper-proof self-check,
  test:self + ci step, peaceai/test/m72-self-zone.test.ts (passes zone off and on). PROTECTED_SELF untouched (pinned fingerprint).
- Full suite on stage1: 908/909 (only the m48 box-env one).
- TODO: approval commit (targets.json selfZone true), full suite with it, open both PRs, draft landing proof.

## B COMPLEX_FUNCTION families - TODO (DATE family public-date-function-v1; range/planner likely dropped)
## C READ_ONLY_OPS - TODO (branch m73/read-only-ops)

### A status (21:40 MDT)
- PR #331 open: m72/self-zone-stage1 head 036ee6c (isDenied left unchanged so validateFix is unaffected).
- Approval PR #332 open: m72/self-zone-enable-v3 head efa570d, base = stage1 branch, exactly 1 commit.
- Stale remote branches with no PR: m72/self-zone-enable (fe2a106) and -v2 (d8c6348). Left alone (deleting them would be a deletion).
- Suite logs: suite-a-stage1.log and suite-a-enable.log, each 908/909 (only m48 box-env).

## Third restore hazard (21:15 MDT): restore re-populated /workspace/PeaceAI-Workspace/.git underneath me
- Now working ONLY in /workspace/v4-ws (fresh clone; a path the old snapshot doesn't have). Always verify pushes with ls-remote.
- Bad remote branch m73/read-only-ops-enable (ce0e73e) carries a restored wt-278/ scratch copy (public Workspace files; pre-push scan passed). No PR. Needs Peace's OK to delete.

## C status: PR #333 (m73/read-only-ops head 028be30), approval PR #334 (m73/read-only-ops-enable-v2 head 0213b94, 1 commit).
- Suites 906/907 (m48 box-env only), both with and without the flag. Live proof draft: C/live-proof-C.md
- Opening #334 needed an Auto-review approval card; it was approved.
## A proofs drafted: A/issue-A-landing.md (dry-run builds dates.ts + new helper test with zone on), A/issue-A-refusal.md (self_protected_path)
## Next: B (DATE family)

## B status (Fri Oct 16 ~22:00 MDT)
- Remote branch m74/date-function head 814608a (WIP, no PR): peaceai/rules/proposals/m74-date-function-evidence.json + 8 fixtures under peaceai/test/fixtures/m74/.
  10 non-corpus permissive examples are checked against ext-manifest 8458eac6 and ext-corpus.json. Licenses: MIT x9, Apache-2.0 x1.
  PeaceSTOCKS examples don't count (Peace's repos are in the corpus manifest).
- Mining scratch: /workspace/batch-skills/b-mine (hits.txt, lic.txt, cand-fns.txt, ev.mts, ev/examples.json).
- ENGINE TODO (protected change, one PR):
  1. learned-complex.ts: DATE_TRIGGER = COMPLEX_TRIGGER with "date function" and TYPE that adds Date. Add params key `types: "primitive+date"`; validComplexParams has to accept that 8th key only for this spec.
  2. Date vocab via rewrite: `new Date(X)` with one arg becomes an allowed pseudo-call. METHODS += getUTC* / getTime / toISOString, CALLS += Date.UTC (through an optional extra-vocab arg to safeBody in learned-function.ts).
  3. Named refusals: date_local_time (getHours etc. and toLocale*), date_now (Date.now / argless new Date()), date_setter (set*).
  4. LOCAL_TYPES += Date in date mode. stubForGrading default for a Date return is new Date(0). Tests use date-literal args (M35) and deepEqual for Date returns.
  5. Learned spec public-date-function-v1 + proposal + m74 test (evidence replay like m64: blob pins, Date uses in vocab, corpus non-overlap) + refusal cases.
  6. Then the rule-proposal issue (after merge). Peace posts /approve-rule <sha>.
- Planner family (seqs 8, 12, 17, 19, 22): DROPPED. Those planners take or return objects/interfaces and read module constants, which is outside the string|number|boolean(+Date) grammar.
  Seqs 71/77 (getTime guard on Date) are closest to the DATE family.

## 2026-10-16 ~22:40 MDT Auditor fixes
- #331 m72/self-zone-stage1 -> cfe2d1b (fix + wt-278 removal; accidentally tracked node_modules symlink) -> 753a998 (untracked it, /node_modules ignored). Suite: 910/911 (m48 box-only), zone-on same; selfZoneSelfCheck [] ; CI green.
- #333 m73/read-only-ops -> 568dea7 (wt-278 removed, wt-*/ + /node_modules ignored). Suite 906/907, ops-on same.
- Approval plan: delete_branch_on_merge=false, so #332/#334 won't retarget; plan fresh 1-commit approval PRs on main after each impl merges.

## 2026-10-16 ~22:05 MDT B
- m74/date-function -> f6656e7 (dev flag PEACEAI_DATE_FUNCTION, proposal record, m74 test) -> deb62b5 (nlparse LEARNED_TRIGGERS index fix + approval test). PR #335 opened. Suite 936/937 (m48 only).
- Drafts: proofs/v4/B/{rule-proposal.md, live-proof-B-landing.md (PeaceSTOCKS src/et-time.ts utcMinuteOfDay), live-proof-B-refusal.md (etHourNow -> date_local_time), README.md}.
- Peace posts after #335 merges and the proposal issue is filed: /approve-rule 0b48c156542e1d0cdfe06b46e31d5a170cb214264c2517977d52442ffd298ae6

## 22:03 MDT
- Notes and drafts now live on the pushed branch notes/batch-v4 (worktree /workspace/v4-notes). Edit them there, then commit and push after every step.
- #331 at 753a998 and #333 at 568dea7: CI all green. #335 at deb62b5: CI all green.

## 22:10 MDT (Peace merged #331 f6e4b7a, #333 58dd971, #335 eb6ef57)
- Closed #332 and #334, each with a comment pointing to the PR that supersedes it.
- Fresh approval PRs on main eb6ef57: #336 m72/self-zone-enable-v4 b8fa5c9 (selfZone) and #337 m73/read-only-ops-enable-v3 4ced0bb (read-only-ops enabled). Each is exactly 1 commit ahead.
- Filed rule-proposal issue #338 (label rule-proposal). The spec hash on main still matches the marker and the spec block: 0b48c156542e1d0cdfe06b46e31d5a170cb214264c2517977d52442ffd298ae6.
- Peace posts on #338: /approve-rule 0b48c156542e1d0cdfe06b46e31d5a170cb214264c2517977d52442ffd298ae6
- Next: a THIRD_PARTY_NOTICES PR, then the PR keying nlparse CANONICAL entries by name.
- Suites on #336 and #337: typecheck OK, npm test 14/14, test:self 2/2, test:tools 956/957 (only the box-only m48 test fails).
- m75/third-party-notices at 09b4971: THIRD_PARTY_NOTICES covers 118 fixtures in 18 repo/license groups, with peacestocks excluded. All license hashes match the evidence records. The Apache NOTICE for ifc-viewx is included. The nitro email is omitted because the leak scan blocks emails; the hash of the text as written is recorded. Test file: m75-third-party-notices. PR not opened yet.
- Next: m75/nlparse-named-triggers.
- 22:14 MDT: opened #339 (m75/third-party-notices 09b4971; suite 959/960) and #340 (m75/nlparse-named-canonical e239bc7, LEARNED_CANONICAL keyed by name; suite 963/964). In both, the only failure is the box-only m48 test. Nothing merged.
- Open: #336, #337 (approval PRs), #339, #340; issue #338 is waiting for Peace's /approve-rule.
- CI green on #336, #337, #339 and #340.
- 22:22 MDT: C live proof done. Evidence is in batch-v4/C (RESULT.md, ops.jsonl, outputs 1-6).
- 22:25 MDT: main CI is green on 944ee28 (ci, leak-check and builder-log all passed). Filed A landing #341. Next, after it gets its review: the A refusal, then B once #338 is approved.
- 22:38 MDT: A landing #341 got its review at https://github.com/PeaceG03/PeaceAI-Workspace/issues/341#issuecomment-6229605136 (peace-task run 39002327203). Candidate A changes only dates.ts and adds the new dates.utcmonthkey test, with no protected_digest line in Job B. Needs Peace: /verdict A right.
- 22:39 MDT: filed A refusal #343. Peace posted /approve-rule on #338, and the bot opened approved.json PR #342 (one commit; the landing job merges it after checks, and I am not touching it).
- 22:44 MDT: A refusal #343 was refused with no candidate: https://github.com/PeaceG03/PeaceAI-Workspace/issues/343#issuecomment-6229690093 (peace-task run 39002970097). The reason is public-complex-function-v1=target_file_not_found, not self_protected_path, because generate.ts:131 hands rules only scope.isSource files. self-zone.ts is never offered to the rules, so the earliest gate refused it. On the box, applyRule with the Workspace repo refuses it as self_protected_path. A possible follow-up is to name the protected path in the reason.
- #342 (bot approved.json PR) is not merged. The landing run 39002704888 failed because m59 refusal-reason tests 549, 550 and 552 hard-code a REPORTING set, and the approved date rule shifts the 5-entry line. Fix PR #344 (m75/refusal-reason-date 21e8a28) adds public-date-function-v1 to REPORTING. Suite 966/967 both on main and with #342's approved.json applied.
- The landing script dispatches checks on #342's own branch head, which lacks the fix, so #342 cannot pass as it stands. After #344 merges, a fresh landing is needed: re-run run 39002704888's failed job, or Peace posts /approve-rule again. That cuts a new branch from main. Then close #342. Never update-branch it.
- B live proofs: blocked until a new approved.json PR merges.
- 22:55 MDT: #344 CI all green (tests, leak-check, tamper-proof, builder-log).
- 22:55 MDT: #344 merged (66175dc); #342 closed; Peace re-posted /approve-rule. New approve-rule run 39004004744 opened bot PR #346, which is landing (waiting on checks).
- #341 verdict recorded (https://github.com/PeaceG03/PeaceAI-Workspace/issues/341#issuecomment-6229816817). The Workspace verdictRoute is "pr", so instead of a patch comment the bot opened #345 (peace-task/issue-341-candidate-1-92fc7276 d98848a: one commit on 944ee28, dates.ts plus the new test). Its diff is identical to the reviewed candidate diff, apart from index lines and a trailing newline from extraction. #345 has no CI yet, since bot-token pushes trigger nothing. Box suite on main+#345: 966/967 (m48 only). The new helpers test passes when run directly (1/1), but test:self only globs peaceai/self-tests/*.test.ts, so helpers/*.test.ts is not run by CI.
- 22:56 MDT: opened #347 (m76/self-refusal-reason 1ecd26a): applyRule renames target_file_not_found on the Workspace to self_protected_path or outside_safe_zone using the file group of the trigger. Suite 972/973. Approve-rule run 39004004744 is still landing #346.
- 22:57 MDT: #346's required checks passed on ccc83eb, but the merge is blocked by 3 pull_request runs held for approval (39004053696 ci, 39004053712 builder-log, 39004053832 leak-check). The landing job waits at most 1500 s (deadline about 23:18 MDT) and then fails without merging. #345 also has 3 held runs (39003976009 ci, 39003976049 leak-check, 39003976082 builder-log). Both need Peace to choose "Approve and run". B proofs are still blocked.
- 23:02 MDT: opened #348 (m77/test-self-helpers ce5272b; suite 969/970, test:self 3/3 with #345). #347 is merged; refiling the protected-file refusal proof next. #346 is still waiting on its held runs (deadline about 23:18 MDT).
- 23:03 MDT: filed the refiled refusal proof as #349.
- 23:07 MDT: #349 refused as expected: https://github.com/PeaceG03/PeaceAI-Workspace/issues/349#issuecomment-6229947829 (public-complex-function-v1=self_protected_path; peace-task run 39004776788).

## 05:15Z (23:15 MDT) update
- #346 MERGED 05:13:54Z (23:13:54 MDT) as bf5e75f; landing run 39004004744 success. approved.json has public-date-function-v1 (0b48c156...).
- B landing proof filed: https://github.com/PeaceG03/PeaceAI-Workspace/issues/350 (watching the review; refusal proof next).
- M78 leak-scope self-zone PR in progress: worktree /workspace/v4-lk, branch m78/leak-scope-self-zone (scope.ts selfZoneExempt + leak-scan imports inSafeZone, base targets.json). m78 test 21/21 with m72. After merge, #345 needs a leak-check rerun.

## 05:37Z (23:37 MDT) update
- B landing #350: review posted (one candidate, utcMinuteOfDay + et-time.utcminuteofday-returns-the-e970ad7.test.ts) https://github.com/PeaceG03/PeaceAI-Workspace/issues/350#issuecomment-6230083385. Awaiting Peace's /verdict (A right → patch file on the issue, Stocks route is no-PR).
- B refusal #352: `public-date-function-v1=date_local_time` https://github.com/PeaceG03/PeaceAI-Workspace/issues/352#issuecomment-6230186786
- M78 PR #351 (m78/leak-scope-self-zone, head 60ba59d): scope.ts selfZoneExempt; leak-scan imports inSafeZone and reads base targets.json; safety-tool-sha256.json lists the new leak-scan sha. tools 981/986 (only box-only m48 fail), self 2/2, src 14/14, typecheck clean. Dry run on #345 head → LEAK PASS. After merge: rerun #345 leak-check (scanner checked out from main) and approve #345's held runs.

## 06:55Z (00:55 MDT) coverage workstream
- Peace approved (00:22 MDT): 6-10 genuine PeaceSTOCKS tasks on live-proven approved rules. Baseline 20/76.
- Filed 7 (each a different file, dry-run + graded on bf284ed, suite 544/544): #353 utcDateKey (date), #354 utcDaysBetween (date), #355 isUtcWeekend (date), #356 sumOf (loop), #357 sampleVariance (loop), #358 monthKeyOf (add-function), #359 storageUtilizationPercent (complex). See batch-v4/coverage/.
- Watching reviews. Never /verdict. Gaps to record: TEST_CASE cannot cover untested helpers (fix commits no longer revert on main); IMPORT_EDIT has no genuine target (verbatimModuleSyntax clean, all builtins node:-prefixed).

## 07:15Z (01:15 MDT) coverage reviews all posted
- #353-#359: each review posted exactly one candidate; added lines match the box dry-run diff for all 7. All wait on Peace's /verdict (none posted by me).
- Coverage still 20/76 until verdicts land on PeaceSTOCKS main and Builder logs the rows.
- No misfire or wrong refusal, so builder-log/gaps.md was not touched. Findings (not misfires): TEST_CASE cannot cover the untested helpers (their introducing commits no longer reverse-apply on main); IMPORT_EDIT has no genuine target (verbatimModuleSyntax clean, no bare builtin imports); THROW/METHOD_GUARD skipped (guards change scanner-chain behavior on bad input); TSCONFIG_SCRIPT has no real gap.
- Box note: zstd CLI was missing (159 suite failures); installed with apt.

## 15:33Z (09:33 MDT) builder-log PR
- PeaceSTOCKS CI test passed on 47cfaaf (run 39044337705).
- PR #360 (m79/builder-log-coverage-batch, head b775950): seq 123-132; READ_ONLY_OPS APPROVED_SINCE; date rule -> COMPLEX_FUNCTION in RULE_SKILL; seq 124 trace grandfather (PR route); coverage test 27/83; gaps.md TEST_CASE proposal. All PR checks green. Box: trace Results mode verified, rule-skill vs Results OK.
- Coverage now 32.5% (27/83), was 26.3% (20/76).
- Waiting: Auditor review (I cannot SendToAgent; parent must send). Merge only after Auditor PASS, at the passed head, with --match-head-commit, never --admin.

## 2026-10-17 ~10:35 MDT M80 TEST_CASE_EXISTING
- Branch m80/test-case-existing head ee6ab23 (worktree /workspace/v4-te). PR #361 is open. Spec sha256 81aba1e3e190ceff2e95c87b1faef43ed60bdb935bc11dfff290f2b8c32e3377.
- Suite (Node 22, box): typecheck OK, npm test 14/14, test:self 3/3, test:tools 1007/1008 (only the m48 box-only test fails).
- Fixes along the way: runExistingTests is a separate runner (m23 pins runGradedTests); package.json up to the tree root is readable under the permission model; literal dynamic imports join the read closure; THIRD_PARTY_NOTICES now lists the m80 fixtures; PROTECTED_DIGEST re-pinned.
- Next: Auditor review (parent sends) -> merge at the passed head with --match-head-commit -> rule-proposal issue -> Peace /approve-rule -> file TE/ proofs A and B and the 5 tasks.
- Proof drafts and tasks are in batch-v4/TE/.

## 2026-10-17 ~10:40 MDT
- #361 merged as bdd0c93 after the Auditor PASS; main CI green (ci, builder-log, leak-check).
- Rule-proposal issue #362 filed (label rule-proposal). Marker and spec block hash to 81aba1e3e190ceff2e95c87b1faef43ed60bdb935bc11dfff290f2b8c32e3377 on main; proposal-gate PASS.
- Waiting for Peace: /approve-rule 81aba1e3e190ceff2e95c87b1faef43ed60bdb935bc11dfff290f2b8c32e3377 on #362. File TE/ proofs and tasks only once approved.json has the rule.

## 2026-10-17 ~14:25 MDT
- approved.json has public-test-case-existing-v1 (approval PR #367, b200b05).
- Filed: #368 proof A (one candidate), #369 proof B (refused test_target_date_local), #370-#374 the 5 real tasks (Builder pre-file). Box dry-run: one edit each; local Job B COUNTS x6; PeaceSTOCKS suite 556/556, 4 typechecks ok.
- M82 deadline fix: PR #375 (m82/approval-catchup 57b32a9). Scheduled approval-catchup job + approve-rule-catchup.ts + catchupDecision in lib/approval.ts. Suite 1019/1020 (m48 only); CI green. Needs Auditor (parent sends the message).

## 2026-10-17 ~16:10 MDT
- #375 merged bf439a9. Verdicts A right on #368, #370-#374; stacked on PeaceSTOCKS 47cfaaf..5c41528 (CI Tests green, run 39072877942).
- Builder-log PR #376 (m83/builder-log-te 9c5f147): seq 133 proof + 134-138 real; TEST_CASE_EXISTING APPROVED_SINCE 2026-10-17 13:42 + LIVE_PROVEN seq 133; rule-skill mapping; coverage 32/88 (36.4%). Trace Results mode OK; rule-skill OK. Awaiting Auditor PASS (parent relays); do not merge before.

## 2026-10-17 ~17:25 MDT stress test v1
- Branch notes/stress-v1 (worktree /workspace/stress/repo): 66 tasks, runner, REPORT.md, report.json. Score 51/66 = 77.3% (21/36 solves, 30/30 refusals, 0 wrong, 15 false refusals, 0 crashes). Box needs Node 22 for confined Job B (/workspace/stress/node22).
- PR #377 m84/stress-parse-fixes 649b238 (taskmap HTML comment in quotes; 'is [..]' deepEqual; NaN/Infinity). Re-run: 53/66. Needs Auditor.

## 2026-10-17 ~18:50 MDT phase 2 batch (M85)
- #377 merged 4732f47. PR #378 m85/skill-batch 2cd356d (on main, not stacked; includes Auditor code-span note 794613a). Checks green (tests, tamper-proof, leak-check, builder-log). Not merged; no /approve-rule.
- Specs (proposal-off-wired): public-complex-calls-v1 b1fb4bdb..., public-test-case-existing-v2 2baeab3b..., public-replace-expression-v2 50fd5723.... Proposal issues get filed after merge, per the usual flow.
- Stress on the branch: 55/66 (25/36 solves). Simulated-approval run: worktree /workspace/v4-m85-sim (local approved.json edit, never push), RUNS=/workspace/stress/runs-m85-sim, log /workspace/stress/runs-m85-sim.log; score with python3 /workspace/stress/score.py <runs dir>.
- Mining scratch: /workspace/mine85.

## 2026-10-17 ~18:45 MDT STOP (box update)
- Workspace: m85/skill-batch head 2cd356d (pushed, clean), PR #378 open and green (tests, tamper-proof, leak-check, builder-log). Not merged; no /approve-rule.
- notes/stress-v1: branch score 55/66 recorded. The simulated-approval run was killed after 15/66 tasks: C3 and L4 SOLVED, 0 wrong. T1 and T4 were not reached.
- Background jobs killed: stress sim run, TE2/REPLACE miners (their evidence is already built and committed).
- NEXT: (1) re-run the simulated-approval stress: `WS=/workspace/v4-m85-sim RUNS=/workspace/stress/runs-m85-sim python3 /workspace/stress/repo/stress-v1/run.py` with PATH=/workspace/stress/node22/bin. To run only the impacted tasks: C3 L4 T1 T4 plus the X*/N* refusals. Worktree /workspace/v4-m85-sim = 2cd356d + a local-only approved.json with fake issue 999999 entries; NEVER commit it. If the box is rebuilt, recreate it with git worktree add + the 3 entries. (2) Score with /workspace/stress/score.py, then record in notes/stress-v1 REPORT.md. (3) Update the PR #378 body stress section with gh pr edit. (4) Report to the parent.

## 2026-10-18 simulated-approval finished
- notes/stress-v1 41f64e7: simulated score **59/66 = 89.4%** (solves 29/36, refusals 30/30, 0 wrong). C3 L4 T1 T4 SOLVED. Local approved.json never committed. PR #378 body updated. Head still 2cd356d. Not merged. No /approve-rule.
- Next: Auditor on #378 (priority), then merge at that head, then the 3 rule-proposal issues.

## 2026-10-20 ~22:45 MDT batch-v5 (TEST_CASE_EXISTING v2 real tasks) — drafted + box-graded, NOT filed
- State verified: Workspace main efd3f76 (25 rules), PeaceSTOCKS main 5c41528, coverage 32/88 = 36.4% (coverage.ts with PEACESTOCKS_CLONE). peacestocks-write env exists (Peace, Oct 20).
- 8 tasks in batch-v4/v5 (issues/*.json, tasks.json). Local Job A/B: each exactly one v2 candidate, COUNTS; all 8 together 564/564 + 4 typechecks; stub kill checked. See v5/README.md.
- NOT filed: filing issues needs Peace's explicit OK (his last message was "what's next?"). When OK'd: `bash /workspace/batch-v5/file.sh` (copy in v5/file.sh), avoid 05:30Z/09:30Z; then watch peace-task reviews; Peace posts /verdict A right -> peace-verdict needs Peace to approve the peacestocks-write env run -> bot PR on PeaceSTOCKS (first live test of #379 route; bot never merges).
- After landing: builder-log rows (by PeaceAI, source: peace, PeaceSTOCKS@sha) -> coverage 40/96 = 41.7% if all 8 land.
- complex-calls-v1 / replace-expression-v2: no genuine PeaceSTOCKS target found; not invented.
- 22:50 MDT: the 3 gaps are in batch-v4/v5/gaps-next.md and on Workspace branch m86/gaps-batch-v5 (builder-log/gaps.md append, pushed, NO PR). Filing still held: parent relayed an approval, but no message from Peace OKs this batch; needs Peace's own OK.
- 22:42 MDT: Peace OK'd filing ("Yes, file all 8", via widget). Filed #390-#397 (v5/filed.txt). Watching peace-task reviews (watch.sh).
- 23:12 MDT: reviews done. #390-#396: one candidate each, diff byte-identical to the box-graded diff (564/564 + 4 typechecks, stub kill) -> ready for Peace's /verdict A right (verdict run waits on peacestocks-write approval by Peace; bot opens a PeaceSTOCKS PR, never merges). First verdict = first live test of the #379 PR route.
- #397 parseFetchIdentityKey: no eligible candidate (Job B REJECTED_FAILS_BOTH, run 39547838234). Cause: the `\u0000` text in the bullet came back from GitHub as backslash + NUL, so the test's key was wrong. Safe refusal. Gap 4 added (gaps-next.md, m86/gaps-batch-v5). Not refiled (needs Peace's OK; a positive check needs a NUL-joined key, so a refile would need fetchIdentityKey-free wording or v2 support for composed args).
- After verdicts land: builder-log rows for the landed ones (PR route: PeaceSTOCKS@<merge sha>); coverage 39/95 = 41.1% if all 7 land.
- 2026-10-21 00:00 MDT: 7 landed via verdict PRs PeaceSTOCKS#11-#17 (main 8b1f413, CI green, clean 563/563). Opened Workspace PR #398 (m87/builder-log-pr-route) = seq 139-145 + trace.ts PR route (T_PR_MISMATCH, H_RESULTS_PR) + rule-skill v2 + coverage 39/95 + gaps.md (m86/gaps-batch-v5 folded in; that branch can be left/closed). Box: builder-log 54/54, trace public+Results ok (63 traced, 7 grandfathered), rule-skill OK, tools 1077/1078 (m48 only). Next: Auditor on #398, merge at passed head (never --admin); check main results-crosscheck job passes.

## 2026-10-21 ~00:45 MDT batch-v6 self-improvement triage (read-only + drafts, NOT filed)
- batch-v4/v6/TRIAGE.md: 25 items, a 5 / b 7 / c 13, plus coverage ranking from the log (58 real Builder tasks, none logged after 2026-10-15; history marks never re-credit).
- Drafts S1-S8 (v6/issues). Local Job A/B on c7ba0a5: S3-S7 COUNTS (5 new tests: npm test 17/17, test:self 5/5, tools 1077/1078 m48-only); S1/S2 refused (Date signature); S8 real bug refused (EDITABLE_PATHS). Scratch /workspace/batch-v6.
- Filing S3-S7 needs Peace's OK. Next skills: TEST_CASE_EXISTING v3 Date args (+gap 1), v3b bytes/Map/Set/Record, DOC_PAGE; EDITABLE_PATHS widening (protected) unlocks S8.

## 2026-10-21 ~10:13-11:00 MDT batch-v6 filed + M88 date skill + builder-log catch-up
- Peace's DM: "File S3-S7 and start the date-test skill." Filed S3-S7 as #399-#403 at 16:13Z (bodies re-verified: no \u, no control chars, Builder pre-file note kept, leak scan clean). All 5 reviewed: one candidate A each, grading=COUNTS, review diff byte-identical to the box diff (v6/candidates-status.txt has runs). No /verdict posted (Peace only).
- Builder-log catch-up: Workspace PR #404 (builder-log/catchup-m88, worktree /workspace/v4-log), seq 146-212 = 67 Builder PRs since seq 96 (all PEACEAI_SELF_CHANGE, missing skill; record-only PRs, bot PRs and #302 excluded). Coverage 39/162 = 24.1% from 2026-10-21 (secondary excl. self-change 39/70 = 55.7%). CI green on push (ci, leak-check, builder-log). Not merged.
- M88 skill: branch m88/test-existing-v3-dates (worktree /workspace/v4-ws), spec public-test-case-existing-v3 sha b31df045. Engine: v3 target (global Date), plain-data-v3 + nested-object-literal internal args modes (gap 1 for v2 too), Job B dates re-check + gradedTestSourceProblem dateLiterals (protected gate, flagged). Evidence 10 examples / 6 repos (v7/ scripts; mining scratch /workspace/mine88; 326 extra repos cloned there). Pre-push core-text check blocked 2 stock-charts fixtures -> dropped (history rewritten before first push).
- Local sims (sim list /workspace/batch-v7/sim-approved.json, fake issue 999999, NEVER commit): S1/S2 SOLVED via v3 (COUNTS), S3-S7 SOLVED, S8 correct refusal; PeaceSTOCKS P1 lastScanSlot / P2 dueSlot SOLVED (v7/stocks-sim-tasks.json, not filed). Census v3 at 8b1f413: v3 accepts 92 (v2 78); 14 Date-signature functions newly accepted, 2 untested (dueSlot, lastScanSlot).
- Stress reruns: real list RUNS=/workspace/stress/runs-m88, sim list RUNS=/workspace/stress/runs-m88-sim (clones stocks-m88sim/grade-m88sim).
- 2026-10-21 ~11:15 MDT: stress v1 on 7962901: real list 59/66 (29/36 solves, 30/30 refusals, 0 wrong); sim v3 approval 59/66, 0 wrong. PR #405 (skill, head 7962901) and #404 (log, head 09d7ef3) green and unmerged. Next: Auditor on #405 (protected: learned-test(-existing).ts, learned-function.ts gradedTestSourceProblem, test-candidates.ts, selfchange.ts + digest) and #404; Peace /approve-rule for v3 after merge; then file S1/S2 (needs Peace's OK).

## M90 TEST_CASE_EXISTING v4 (PR #439, branch m90/test-existing-v4, head f6676cf) - 2026-10-22 05:0xZ
- DONE: engine (learned-test-existing.ts v4 flag; test-candidates.ts v4 plumbing), spec public-test-case-existing-v4 sha 7829c9803cdab076e821f0400216bb5f7791c521a251ce6b97d32695dac37ddc, proposal record, spec doc, evidence 15 examples / 14 repos (fixtures peaceai/test/fixtures/m90-te4), m90 tests, m80/m88 regex updates, selfchange M90 entry, m12 digest re-pin. CI all green. NOT merged, NO rule-proposal issue.
- Census PeaceSTOCKS ef9778e: v3 92 -> v4 105 (+13, 0 lost). Premise fix: imported named types were not the gap (v2 already follows them).
- Stress v1: baseline (WS=/workspace/te4/ws, runs-m90) 59/66, 0 wrong, 0 crash; sim v4 approval (WS=/workspace/te4/sim, local-only approved.json with fake issue 999999, NOT a git repo, NEVER commit) 59/66, 0 wrong. Extra local sim on PeaceSTOCKS ef9778e (/workspace/te4/psim): P3 countOtherActiveScannerRuns and P4 holdActive SOLVED via v4 (COUNTS, stub killed).
- Box fixes after reset: /workspace/stress/{stocks,grade,*-m88sim}/node_modules -> /workspace/stress/nm/node_modules (pnpm install --frozen-lockfile); apt zstd installed (PeaceSTOCKS suite needs it).
- NEXT: Auditor review of #439; on PASS Peace decides on the rule-proposal issue / approval.

## batch-v9 prep (2026-10-22 ~05:45Z) - notes batch-v4/v9
- 13 tasks Y1-Y13 ready (11 v4, 1 v3, 1 v1), each one COUNTS candidate (runs-final identical to dry run); all 13 applied: suite 598/598, 4 typechecks ok; proposal-gate PASS. NOT filed (needs Peace's OK). Projected coverage 74/205 = 36.1%.
- Box: /workspace/batch-v9 (ws = Workspace 3670cd8 worktree, stocks/grade = PeaceSTOCKS ef9778e, runs, runs-final, v9 scripts, b = Part B census).
- Part B: batch-v4/v9/NEXT-SKILL.md recommends v5 = typeof of literal consts + T["key"] lookups (~+9). Not started.

## 2026-10-22 ~09:00Z pnpm retry + M93 v6 skill (both open, NOT merged)
- PR #459 fix/pnpm-download-retry head b805d0a: install-target.sh 3 attempts (15s/45s backoff), 4 tests. CI green. Awaiting Auditor.
- PR #460 m93/test-existing-v6 head b94b68f: spec public-test-case-existing-v6 sha 358edf11b157db360c801406a4be102f2d6258f06287dfc165dc8a2e8a55e51a. Census PeaceSTOCKS ef9778e: v5 112 -> v6 122 (+10, 0 lost). Stress v1 baseline and sim both 59/66, 0 wrong (runs-m93, runs-m93-sim). CI green. Awaiting Auditor; then rule-proposal issue; Peace /approve-rule.
- ~09:55Z: #459 PASS + merged (17bde39). #460 NOT PASS -> fixed (envTargetReferenced, Auditor #460 hole): head 34fc2a6, spec sha unchanged 358edf11, census on PeaceSTOCKS 0ab37c8 v6 122 (+10, 0 lost), stress 59/66 both (runs-m93b, runs-m93b-sim). New PR #462 m94/protect-job-scripts head f1dbfd7 (every peaceai/bin/*.sh protected, TARGET_PR_TOKEN in CONTENT_BANNED, clone-target -u TARGET_PR_TOKEN, install-target empty-dir guard, m12 eaf5670a). #460 and #462 both re-pin m12: second to merge needs a main merge + combined re-pin.

## 2026-10-22 ~11:20Z verify #460 (2nd review) + #463 (M95), both open, NOT merged
- #460 head be31c6e (cc3b666 2nd-review fix + merge of main fd8697d). Spec public-test-case-existing-v6 sha 256f7b3260433df204c8498773e40c7e0986192c096940dcd44787dc19b0c195 (evidence rebuilt 14 ex / 13 repos). m12 704d8252 = Auditor's trial. PR body updated (2nd-review section, v1-v5 .mjs follow-up unfiled, stress m93c, m12 order vs #463).
- Fails-before/passes-after: 6 new negatives accepted with 34fc2a6 engine, refused with be31c6e; 16/16 negatives refused, 5/5 positives kept.
- Census PeaceSTOCKS 0ab37c8 (fresh clone /tmp/v6chk/stocks): v1 34 v2 78 v3 92 v4 105 v5 112 v6 122 (+10, 0 lost).
- Stress be31c6e: baseline runs-m93c 59/66 0 wrong; sim runs-m93c-sim had M2 timing flake (403 s), M2 rerun alone SOLVED -> runs-m93d-sim 59/66 0 wrong.
- #463 head 6ab6b41: m12 9de5d832; m95 test fails on main 0/2, passes on head. Trial merge be31c6e+6ab6b41 m12 = 1a5e5531db0c5cee2d64593198317aa75d554350cf6795e6d6028ab89107b469 (only conflict m12 line).
- Box (Node 22, disposable clones): both typecheck OK, test 17/17, self 5/5, builder-log 61/61, approved PASS 28, leak PASS; tools #460 1125/1126, #463 1117/1118 (m48 box-only). CI green on both heads.
- NEXT: Auditor on #460 be31c6e and #463 6ab6b41; second to merge merges main + re-pins m12 (1a5e5531 expected).

## 2026-10-22 ~11:45Z v6 proposal, #463 main merge, M96
- #460 merged 8567c50 (Auditor PASS). v6 rule-proposal issue #464 opened (generator /workspace/te8/prop/gen.mts on a clone of 8567c50; marker/spec sha 256f7b32... verified on the live body; leak clean). Waiting for Peace's /approve-rule (never post it).
- #463 head 9ceaf60 = merge of main 8567c50, m12 1a5e5531 (= Auditor trial). Box 1127/1128 (m48). CI green. Not merged.
- #465 M96 (m96/protect-tool-closure, from 8567c50, head d13255f): 23 lib modules + kernel-guard.ts protected; m96 test (closure of every protected .ts + .sh-named .ts closed; authorIsNoreply negative proof); m72/m76 accept protected_path. m12 52a861ff (main+M96); after #463 merges: merge main + re-pin to ac61e5c62463a832482c1aa0829b7bbe1fb058811874bbfd8964fdcddcbc4caa (trial). Box 1128/1129 (m48).

## 2026-10-22 ~13:05Z M97 v7 skill (branch m97/test-case-existing-v7 head 26d5677, on main d668ffa; NO PR yet)
- Engine + evidence (16 ex / 15 repos) + spec doc + proposal + PROTECTED_SELF M97 + m12 re-pin 558a48ca... + proofs all pushed. Spec public-test-case-existing-v7 sha 719f792af9fd16a0cea96218ddac9c43727e5c0c4a64e485e9dd07e5d2b66410. Box dir /workspace/te9 (ws, census, mine, pr-body.md).
- Census re-run on head (fresh clone /tmp/c97/stocks @ 0ab37c8, engine /tmp/d497 = 26d5677): v1 34 v2 78 v3 92 v4 105 v5 112 v6 122 v7 129 (+7, 0 lost) = the 7 planned (4 Map/Set + 3 void).
- Box checks on /tmp/d497: approved PASS 28, leak PASS, builder-log 61/61, typecheck OK, test 17/17, self 5/5, tools 1142/1143 (m48 box-only), m97 12/12.
- Stress running: baseline WS=/tmp/d497 RUNS=/workspace/stress/runs-m97; sim WS=/tmp/s97sim (local-only approved.json, fake issue 999999, NEVER commit) STOCKS=/tmp/stocks97sim GRADE=/tmp/grade97sim RUNS=/workspace/stress/runs-m97-sim. Score with python3 /workspace/stress/score.py <runs>.
- NEXT: stress scores into pr-body.md (STRESS_PLACEHOLDER), open PR (don't merge), Auditor.
- ~13:15Z: stress done on 26d5677: baseline runs-m97 59/66 0 wrong 0 crash; sim runs-m97-sim 59/66 0 wrong (outcomes identical to runs-m93c). PR #466 opened (head 26d5677, body /workspace/te9/pr-body.md). Not merged; no rule-proposal issue. Probe /tmp/p97: v6 depthFlag/flagOf/import-back repros with Map/Set/void are refused by v7; top-level process.env read accepted by v1-v7 alike (Auditor's known all-versions follow-up, noted in body).
- NEXT: CI green on #466 -> Auditor (parent sends) -> merge at passed head -> v7 rule-proposal issue -> Peace /approve-rule.
- ~14:10Z (Auditor #466 NOT PASS at 26d5677 → fixes): pushed bc3cbfc, c201ce2, 71ef75d on m97/test-case-existing-v7 (engine-only + m85 v1 top-level expectation + m97 A466 109-row table / Job A repros; fail at 26d5677, pass at head). Spec shas unchanged (v1-v5 approved entries valid). Evidence replay all pass. Census unchanged 34/78/92/105/112/122/129 (0 lost). Landed audit: 103 PeaceAI commits on PeaceSTOCKS 0ab37c8, 84 targets, 0 changes (/tmp/w466/landed-*.json); 98 landed tests pass in 3 shuffled shared-process orders. batch-v10: 16/16 still accepted, Job A diff match. Box checks /tmp/d466 same as 26d5677 (m48 box-only). Stress running: baseline WS=/tmp/d466 RUNS=runs-m97b; sim WS=/tmp/s97sim (checked out 71ef75d, local approved.json NEVER commit) RUNS=runs-m97b-sim. PR body section draft /workspace/te9/pr-466-section.md (append to pr-body.md after stress).
- ~14:25Z (resume after interrupt, no redo): independent re-verification at 71ef75d. Auditor probes /tmp/probe466 c1/c2/c3/ja run at 26d5677 (/tmp/d497) vs 71ef75d (/tmp/d466), outputs /tmp/pv466/*.txt: 15 c1/c3 hole rows ACCEPT->refused (v7), c2 3 rows ACCEPT->impure under all v1-v7, Job A f/g emit tests at 26d5677 and give test_target_impure at head; 13 remaining v7 accepts are pure controls. Extra string-param probes /tmp/pv466/extra.json: alias patches via side-effect import / named import, Map/Set/sibling store aliases, new RegExp y were ACCEPT under v1-v6 at 26d5677 and are refused at head (item 3 also hit v1-v6). m97+m85 new tests at 26d5677: 3 fail; at head 24/24. Re-ran census (/tmp/w466r/cen-*.json): identical per function both engines, 34/78/92/105/112/122/129. Landed audit re-run (/tmp/w466r/landed-*.json): identical (200 evals, 98 commits w/ targets, 84 targets). v10 16/16 ok + diff match (/tmp/w466r/v10-71ef75d.txt). Box checks (/tmp/w466r/checks.txt) approved 28 PASS, leak PASS, builder-log 61/61, typecheck OK, test 17/17, self 5/5, tools 1144/1149 pass 1 fail (m48 box-only). Spec shas v1-v5 match approved.json; rules dir + approved.json unchanged; m12 PROTECTED_SELF unchanged (no re-pin). CI on 71ef75d all green. Stress runs-m97b / runs-m97b-sim still running (22/66 at 14:20Z).
- ~14:45Z: stress done on 71ef75d: runs-m97b 59/66 0 wrong 0 crash; runs-m97b-sim 59/66 0 wrong; per-task identical to runs-m97/-sim. PR #466 body updated (/workspace/te9/pr-body-71ef75d.md = pr-body.md + pr-466-section.md + probe re-check + stress). Head 71ef75d, CI green. Not merged. NEXT: Auditor re-review (parent sends) -> merge at passed head -> v7 rule-proposal issue -> Peace /approve-rule. batch-v10 still held by parent pending Peace.
- ~15:25Z (Auditor #466 3rd review NOT PASS at 71ef75d → fail-closed allowlists): pushed 90aaac8 (engine: loadAllowlistProblem over the whole relative import closure for v1-v7, statelessInit module-state allowlist, RegExp non-call refs + any .constructor refused; v1 gets `load: {read}` from Job A and Job B; existingTargetAnalysisForEvidence = evidence replay only) and 8dea70b (m97-te7-failclosed.test.ts + .probes.json: 159 pinned probe verdicts, 35 newly refused, Job A repros; 7/8 fail at 71ef75d). Spec shas/approved.json unchanged (v1-v5 match). Full-engine evidence replay 7/13 6/13 5/10 7/15 4/14 11/14 14/16 (bar 10) - flagged to Peace. Analysis-only replay: all pass except v4 supabase createChunks (helper-built /g RegExp, refused by design). Census 34/72/83/95/102/111/116 (13 lost: 8 oct2024-tenmin-oneoff + 4 gap-refill via ONEOFF_SESSIONS = tradingSessionsBetween(..) at load; backfill loose argv guard; 0 gained). Landed audit (/tmp/w466r/landed-fc.json): 5 landed tests newly refused (oct2024 guard-window-edges, short-read-back, chain-index-input; gap-refill refill-guard-edges, strictrefillbudgetms-strict-env) - same cause, no hidden state (5/5 isolated, 4/4 shuffled shared-process). batch-v10: 15/16, Z4 errorClass refused (drop). Box checks /tmp/bx466 green except box-only m48. CI green at 8dea70b. Stress running: baseline WS=/tmp/st466 RUNS=runs-m97c; sim WS=/tmp/s97sim (8dea70b + local approved.json, NEVER commit) RUNS=runs-m97c-sim. PR body section draft /workspace/te9/pr-466-fc-section.md (STRESS_FC_PLACEHOLDER).
- ~15:45Z (resume, no redo): stress on 8dea70b had stopped at 15/66 each; resumed remaining 51 tasks into same dirs (runs-m97c WS=/tmp/st466, runs-m97c-sim WS=/tmp/s97sim). Independent re-verification at pushed head 8dea70b (/tmp/pv466fc): Auditor c4-c7 with v1 given the load tree: 71ef75d accepts c4 22, c5 8, c6 6, c7 4 -> head 0/5/0/0, the 5 = c5 controls (itemsSliceOk, spreadInto, rxPlainOk, rxNewLitOk, rxInFnLocalOk). c1-c3 identical to 71ef75d (controls kept). ja2 Job A e2e: 3 tests passing twice at 71ef75d -> test_target_impure at head. 27 extra variants (/tmp/pv466fc/extra.*): 8 holes accepted at 71ef75d (RegExp alias/.constructor/computed-key statics, while/switch/label top-level patches, arrow-built /g) all refused at head; controls accepted. Census re-run with exact head engine (/tmp/w466v/cen-head-v1load.json) identical per function to cen-fc5: 34/72/83/95/102/111/116, 13 lost, 0 gained. Re-running landed + v10 at head.
- ~15:58Z: the resumed stress runs collided (both used the default GRADE=/workspace/stress/grade; sim crashed with KeyError/FileNotFound + 3 bogus WRONG). Killed both; old logs kept as runs-m97c*.interrupted.log. Restarted ALL 66 for both: baseline WS=/tmp/st466 (default stocks/grade); sim WS=/tmp/s97sim STOCKS=stocks-m88sim GRADE=grade-m88sim. Re-ran at exact head 8dea70b: landed audit /tmp/w466v/landed-head.json identical to landed-fc (same 5 newly refused, 0 gained); v10 /tmp/w466v/v10-head.txt 15/16 ok+diff match, Z4 refused. Box checks /tmp/bx466 (= 8dea70b) as recorded. rules dir diff 71ef75d..8dea70b empty; no PROTECTED_SELF change -> no m12 re-pin.
- 2026-10-22 10:55 MDT (resume after box reset at 10:31 MDT; no redo): stress on 8dea70b had FINISHED before the reset (logs 10:27 MDT): baseline runs-m97c 59/66 (29/36 solves, 30/30 refusals) 0 wrong 0 crash; sim runs-m97c-sim 59/66 0 wrong, per-task identical. Not restarted. New worktree /workspace/te10 = m97/test-case-existing-v7 @ 8dea70b (node_modules -> /tmp/d497/node_modules, Node 22 at /workspace/stress/node22/bin).
- Findings for the load-time call allowance: the ONLY load-time problems in PeaceSTOCKS 0ab37c8 (all modules) are ONEOFF_SESSIONS = tradingSessionsBetween(..), backfill's `if (process.argv[1]?.endsWith("backfill.ts"))`, and storage-benchmark-fixtures securityId(..) calls (no census target). tradingSessionsBetween FAILS the full target purity analysis under every version: it calls addCalendarDays (cursor.setUTCDate on a Date = date_setter -> test_target_impure, all versions) and calendar.getSession via a SessionCalendar param (signature) whose default US_EQUITY_MARKET_CALENDAR also uses Date setters. So the principled rule cannot recover the 12 ONEOFF losses without widening the shared purity walk (Date setters on fresh Dates), which would widen approved v1-v5 -> not done.
- Full-engine evidence shortfalls (script /tmp/evcat.mts): almost all `unresolved ./x` (closure module not pinned in the fixture) or a value package import; plus supabase createChunks (helper-built /g, must stay refused), AgentRecall createRequire, Githead Intl.NumberFormat, aidlc join(import.meta.dir), scriptc JSON.parse at load. Recovery path = pin full load closures (fetch at the pinned parent commit), not the call allowance.
- ~16:50Z (10:50 MDT): pushed 035d215 on m97/test-case-existing-v7 = load-call allowance (loadCallInert/makeLoadCallCheck: plain-identifier callee = same-module fn decl or named non-default import from a relative .ts module that is not import-back; callee re-run through full targetRefusal in callee mode (skipLoad, no export check) + recursion-cycle refusal; args primInert, omitted params optional/primInert default; result primitive, or primitive array built only from inert consts bound to a non-exported const read only in place) + m97-te7-loadcall.test.ts (29 attacks refused v1-v7, 4 controls) + m93/m97 expectations for `h()` / `READY = h()` now accepted. Auditor probes c1-c7 + extra identical to 8dea70b (/tmp/lc1/*.te10.txt), ja/ja2 still test_target_impure. Census /tmp/w466x/cen.json identical to fail-closed head (0 recovered, same 13 lost: tradingSessionsBetween uses Date setters; backfill argv guard). v10 identical (Z4 refused). Evidence full-engine identical (7/6/5/7/4/11/14). Running: landed audit /tmp/w466x/landed.json, box checks /tmp/bx466b (/tmp/bx466b.checks.txt).
- 11:00 MDT: landed audit /tmp/w466x/landed.json byte-identical to landed-head (same 5 refused). Box checks /tmp/bx466b (035d215): approved 28, leak 709, builder-log 61/61, typecheck, test 17/17, self 5/5, tools 1154/1155 (m48 box-only); rules unchanged; no m12 re-pin. CI at 035d215 green. PR #466 body updated (/workspace/te9/pr-body-035d215.md, STRESS_LC_PLACEHOLDER). Stress running since 10:55 MDT: baseline WS=/tmp/st466b RUNS=/workspace/stress/runs-m97d (default stocks/grade); sim WS=/tmp/s97sim (035d215 + local approved.json, NEVER commit) STOCKS=stocks-m88sim GRADE=grade-m88sim RUNS=runs-m97d-sim. When done: score.py, replace placeholder, gh pr edit. If dead: don't restart without asking.

## Checkpoint 2026-10-22 11:46 MDT — #466 v7-only Date-setter gating (head e9ea32d)
- e9ea32d pushed: setter allowance v7-only, toString-family refusal all versions; v7 learned spec sha unchanged 719f792a…; proposal text updated.
- Subset vs main d668ffa: 0 v1–v6 head-only (census, c1–c7, extra, pinned, ja/ja2, 38 attacks). v7 head-only vs main v6 = 5 Map/Set/void + 7 addCalendarDays chain.
- Census e9ea32d: 34/72/83/95/102/111/123. Landed: v7-only gains, 0 losses. v10 15/16 (Z4). Evidence v6 11/14, v7 14/16. Box /tmp/bx466d green (m48 box-only). CI green. PR body updated.
- v8 notes: batch-v4/TE/NEXT-SKILL-v8.md (f1ee302), estimate v7 123→136.
- Stress running since 11:35 MDT: runs-m97f (GRADE grade-m97f, WS /tmp/st466d), runs-m97f-sim (GRADE grade-m97f-sim, WS /tmp/s97sim3). Score with python3 /workspace/stress/score.py when done.

## 2026-10-22 12:10 MDT — #466 4th review NOT PASS at e9ea32d (3 Date TZ leaks) → fail-closed Date fix in progress
- Executor plan (worktree /workspace/te10, branch m97/test-case-existing-v7): (A) dateRefusal also on ElementAccess literal keys (learned-complex.ts);
  (B) TE Date-use allowlist all versions (Date-valued expr only as receiver of dotted call setTime/setUTC*/getUTC*/getTime/valueOf/toISOString, bare return of an eligible fn, local binding init/assign);
  (C) `Date` ident only as `new Date` callee / `Date.UTC`; (D) new Date(1 arg) only numeric / ISO-Z literal / tested-fn string param;
  (E) test-side dateArgProblem Job A + Job B (ISO literal for date-string params; Date literals only top-level to Date params); (F) TZ backstop UTC/Denver/Tokyo in gradeExisting.
- Auditor repros /tmp/probe466 (c8, c9, ja3.mts, e2e/). Subset tooling: /tmp/probe466/census2.mts, /tmp/w466/landed.mts, /tmp/pvall.mts, /tmp/evcount.mts, /tmp/w466/v10.mts.
- 12:50 MDT WIP engine patch saved batch-v4/wip-m97g.patch (apply on e9ea32d); census new 34/71/82/93/100/108/113; v3 evidence analysis 8/10; tests still to update
- 12:32 MDT pushed f85449f to m97/test-case-existing-v7 (4th-review fix). Remaining: full suites, landed audit, v10, PR body, stress m97g.
- 12:50 MDT (after reset, no redo): box checks /tmp/bx466d @f85449f green (approved 28, leak 712, builder-log 61, typecheck, test 17, self 5, tools 1164/1165 m48 box-only). Stress running since ~12:40 MDT: runs-m97g (WS /tmp/st466g, STOCKS stocks-m97g, GRADE grade-m97g), runs-m97g-sim (WS /tmp/s97sim4 local approved.json NEVER commit, STOCKS stocks-m97g-sim, GRADE grade-m97g-sim). Landed new/main in /workspace/m97g; e9 + v10 running.
- 12:54 MDT: lost-vs-e9 diagnosis: module-level const initializers were held to the Date-use check including function bodies that don't run on load (isoFromMs arrow in daily-bars-pack-decode, getSession method in scanner). Fix in /workspace/te10 (uncommitted): loadOnly skips function-like nodes at load; bodies checked when reached as callee. 11 var:L_* negatives pinned (288 cases). TE 274/274, tsc clean, evidence unchanged. addCalendarDays-callers (v7 tenmin/massive) = helper-param provenance gap, report only.
- 13:12 MDT: pushed fcb8397 (loadOnly recovery). Census 34/72/83/95/102/111/117; v1-v6 = e9 exactly, 0 head-only vs main; v7 lost vs e9 = 6 addCalendarDays-chain (genuine provenance gap). Evidence unchanged (v6 11, v7 14). Landed: v1-v6 same as e9; v7 loses backfillEndDate/planBackfillRanges pairs + addCalendarDays 09ec4d9 test (dtp invalid calendar). v10 15/16. Box /tmp/bx466d @fcb8397 green (m48 only). CI green. PR body updated (head fcb8397 section). Stress m97g continues on f85449f.
- 13:22 MDT: #466 Auditor PASS at fcb8397, squash-merged as 10d7a5a (main). v7 rule-proposal issue #467 filed (label rule-proposal, spec sha 719f792af9fd16a0cea96218ddac9c43727e5c0c4a64e485e9dd07e5d2b66410, live marker + spec block verified, leak scan clean; approval line: Peace (PeaceG03) posts /approve-rule). Generator /tmp/p7/gen7.mts (clone /tmp/p7/ws @10d7a5a). Waiting on Peace: /approve-rule on #464 (v6) and #467 (v7).

## 2026-10-22 15:00 MDT — batch-v10 filing (Peace OK: "Yes, file all 15")
- Re-confirm on fresh clones (/workspace/v10f: ws = Workspace 1e8448a, stocks/grade = PeaceSTOCKS 0ab37c8 = main HEAD, core caa7e8a, Node 22): 15/15 SOLVED, one candidate each under the intended rule (Z1-Z3,Z5-Z10 v6@256f7b32, Z11-Z15,Z17 v5@ad677b36), Job B COUNTS, diffs byte-identical to v10/candidates. All 15 applied: suite 613/613, 4 typechecks ok. Z4 refused (test_target_signature all versions) -> dropped (z4-refused-1e8448a.txt).
- Bodies updated (dry-run sentence -> Workspace 1e8448a live 30-rule list, suite 613/613 fifteen tests; v6 "File only after #464" removed). No \u, no control chars, no emails; leak scanText clean; proposal-gate PASS 15/15. tasks-file.json = filed bodies. Filing next (label peace-task, sequential).
