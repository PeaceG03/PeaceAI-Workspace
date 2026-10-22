
## v5 skill (M91, public-test-case-existing-v5) — checkpoint 1

- Branch `m91/test-existing-v5` (from Workspace main 3670cd8), worktree /workspace/te5/ws. Pushed 2 commits
  (engine 477f4e3, spec/evidence/tests on top). No PR yet; no proposal issue.
- Engine: `v5` flag in V2Ctx; `typeof N` of a literal const (local or followed sibling import, never mutated, literal
  init or plain annotation; parameter-name typeof refused) and `T["k"]` on a plain object type (type literal,
  non-generic interface without heritage, alias of a type literal; required property, string-literal key).
  Job B gradeExisting gets `v5`. PROTECTED_SELF M91 entry, digest re-pinned.
- Census (PeaceSTOCKS ef9778e): v1 34, v2 78, v3 92, v4 105, **v5 112 (+7, 0 lost)**: corporateActionCoverageRecords,
  reconstructFeatures, aggregateIntradayBars, planTenMinAlert, isEmptyTenMinRangeManifest, tenMinScanCheckStops,
  stopRecordForScanCancelled. Script: /workspace/te5/census5.mts.
- Evidence: 14 examples / 10 repos (mining in /workspace/te5/mine: mine5.mts, build-te5.mts, corecheck.mts,
  notices.mts, ev.mts). 10 candidates dropped by the pre-push core-text scan (run corecheck.mts before committing).
- Sim: /workspace/te5/sim (tar copy, NOT a git repo, fake approval 999999; never commit). Z1-Z3 (v5 targets) SOLVED,
  1 candidate each, COUNTS.
- Next: stress-v1 baseline (/workspace/stress/runs-m91) + sim (runs-m91-sim), full suite, then open the PR (do not
  merge, no proposal issue).
