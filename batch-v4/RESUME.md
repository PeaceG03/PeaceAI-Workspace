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
