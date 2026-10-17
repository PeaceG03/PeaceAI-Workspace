# Coverage workstream (Peace approved 00:22 MDT Oct 17)

Baseline: 20/76 (26.3%) with PEACESTOCKS_CLONE=/workspace/land-proofs at bf284ed.
Box dry runs on PeaceSTOCKS bf284ed (worktree /workspace/v4-cov/stocks, zstd installed): base suite 543/543.
Each task: exactly one approved rule builds (t6: add-function v1 and v2 build the byte-identical diff, which deduplicates to one candidate),
new test passes with the function and fails at base, suite 544/544, all 4 typechecks ok. Every task appends to a DIFFERENT
source file, so landings never collide.

| task | rule | file | function |
|---|---|---|---|
| t1 | public-date-function-v1 | src/et-time.ts | utcDateKey |
| t2 | public-date-function-v1 | src/us-calendar.ts | utcDaysBetween |
| t3 | public-date-function-v1 | src/scan-backstop.ts | isUtcWeekend |
| t4 | public-loop-function-v1 | src/num-utils.ts | sumOf |
| t5 | public-loop-function-v1 | src/features.ts | sampleVariance |
| t6 | public-add-function-v1/v2 | src/daily-bar-sessions.ts | monthKeyOf |
| t7 | public-complex-function-v1 | src/storage.ts | storageUtilizationPercent |
