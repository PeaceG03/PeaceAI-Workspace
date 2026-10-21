# batch-v5: real tasks on public-test-case-existing-v2 (2026-10-20, drafted, NOT filed)

Base: PeaceSTOCKS 5c41528 (main), Workspace main efd3f76 (25 approved rules), Node 22.23.3, local Job A + Job B via run.py (stress runner).
Census (census.mts): 286 exported functions; v1 takes 34, v2 takes 78 (44 v2-only). Untested or never called directly by a test: picked 8.

| V | function | file | Job A | Job B | box grade |
|---|---|---|---|---|---|
| V1 | tenMinPairManifestKey | src/tenmin-backfill.ts | 1 cand (v2) | COUNTS | pass, kills stub |
| V2 | isIdleScannerRun | src/scan-yield.ts | 1 cand (v2) | COUNTS | pass, kills stub |
| V3 | countGappedPlannedFetches | src/tenmin-history.ts | 1 cand (v2) | COUNTS | pass, kills stub |
| V4 | countOrphanFetches | src/tenmin-history.ts | 1 cand (v2) | COUNTS | pass, kills stub |
| V5 | shouldDispatchHeal | src/tenmin-redispatch.ts | 1 cand (v2) | COUNTS | pass, kills stub |
| V6 | planCancelDispatchedRun | src/tenmin-redispatch.ts | 1 cand (v2) | COUNTS | pass, kills stub |
| V7 | planUpgraded | src/tenmin-mode.ts | 1 cand (v2) | COUNTS | pass, kills stub |
| V8 | parseFetchIdentityKey | src/tenmin-range-reply-dust.ts | 1 cand (v2) | COUNTS | pass, kills stub (manual; run.py mutate_check mis-stubs object-literal return types -> false WRONG) |

All 8 applied together on a clean clone: 4 typechecks ok, npm test 564/564 (556 + 8).

Findings (gaps, not misfires):
- v2 objectArgs detection only sees object literals passed directly; objects inside an array argument fall back to MAX_EXPR_CHARS 200 -> test_refused (first V3/V4 drafts). Bullets shortened to <200 chars.
- An earlier V8 draft with only `is undefined` bullets got Job B COUNTS though a stub returning undefined would pass it: weak test admitted. Final V8 has a positive deepEqual bullet.
- stress run.py mutate_check: `src.index("{", j)` hits a return-type object literal; grader bug only.
- No genuine target found for public-complex-calls-v1 (adds new functions only; nothing needs one) or public-replace-expression-v2 (no known real bug). Not invented.

To file (needs Peace's OK): bash file.sh (gh as PeaceG03, label peace-task -> peace-intake -> peace-task sweep).
