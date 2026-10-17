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
- #331 at 753a998 and #333 at 568dea7: CI all green. #335 at deb62b5: CI pending.
