# batch-v6: self-zone tasks (drafted, NOT filed)
Workspace c7ba0a5, Node 22, local Job A/B via run.py (Workspace variant: target clone + grade clone, typecheck + src + self-tests).
| id | title | rule | local outcome |
|---|---|---|---|
| S1 | [self-tests/helpers] utcDayKey | - | refused test_target_signature (Date) on v1, v2 |
| S2 | [self-tests/helpers] minutesOfUtcDay | - | refused test_target_signature (Date) on v1, v2 |
| S3 | [self-tests/helpers] plural | public-test-case-existing-v1 | 1 candidate, COUNTS, kills stub |
| S4 | [self-tests/helpers] truncate | public-test-case-existing-v1 | 1 candidate, COUNTS, kills stub |
| S5 | [text] truncate short limits | public-test-case-existing-v1 | 1 candidate, COUNTS, kills stub |
| S6 | [text] slugify | public-test-case-existing-v1 | 1 candidate, COUNTS, kills stub |
| S7 | [config] parseQuantity | public-test-case-existing-v1 | 1 candidate, COUNTS, kills stub |
| S8 | [text] truncate negative limit (bug fix) | public-replace-expression-v2 | no candidate (src/text.ts not in EDITABLE_PATHS; reason hidden by the 5-entry refusal line) |
S3-S7 together on a clean clone: typecheck ok, npm test 17/17, test:self 5/5, test:tools 1077/1078 (m48 box-only). Candidate test paths: helpers tests inSafeZone; src tests ordinary new-test scope (leak-scan TEST_FILE + isSafeCandidatePath). Bodies: no \u escapes, no control characters (only the U+2026 ellipsis character, as in the code). Diffs identical across two runs (runs, runs-final).
File only with Peace's OK for this batch (S3-S7). S1/S2 wait for a Date-arg skill; S8 waits for the EDITABLE_PATHS change.
