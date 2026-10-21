# batch-v6 triage: PeaceAI coding its own improvements (2026-10-21, Workspace main c7ba0a5, PeaceSTOCKS main 8b1f413)

(a) PeaceAI can do it today: fits an approved skill AND every file is self-zone (inSafeZone or ordinary src/ scope; leak-scan #351).
(b) needs a new skill (or a safe-zone widening) PeaceAI could plausibly learn next.
(c) stays Builder+Auditor (protected gates, core, workflows, builder-log, ops needing Peace).

## Coverage ranking (numbers from builder-log/tasks.jsonl and coverage.ts at c7ba0a5)
- Log: 145 rows; 67 by Builder, 78 by PeaceAI. Of the 67 Builder rows, 9 are retag bookkeeping (seq 88-96), leaving 58 real Builder tasks, all dated 2026-10-13..14. Builder has logged no row since seq 96 (2026-10-15).
- Real Builder tasks by tag at the time: PEACEAI_SELF_CHANGE 25, OPS_ACTION 13, COMPLEX_FUNCTION 9 (later retagged: LOOP_FUNCTION 5 = seq 8/12/17/19/22, THROW_GUARD 2 = 70/78, METHOD_GUARD 2 = 71/77), WORKFLOW_JOB 4, WORKFLOW_STEP 2, IMPORT_EDIT 1, ENV_FIX 1, CHECK_OBJECT_LITERAL_ARGS 1, TSCONFIG_SCRIPT 1, TEST_CASE 1 (the only one able at the time).
- coverage.ts keeps the historical mark (Auditor #216), so no new skill re-credits those 58 rows. All-time (39/95 = 41.1%) moves only by new rows: each landed PeaceAI real task adds 1 to both sides; n more landings give (39+n)/(95+n).
- Of the 25 PEACEAI_SELF_CHANGE rows, 0 would fit today's self zone (each changes Job A/B engine, rules, approval, workflows or builder-log; read from asked/changed). Of the 13 OPS_ACTION rows, 2 are read-only (seq 1, 73); the other 11 are writes (file/close/dispatch/rebase) that need Peace.

| next skill | past real Builder tasks it covers (log) | current real opportunities (measured) |
|---|---:|---|
| TEST_CASE_EXISTING v3: Date params/returns | 0 | 39 PeaceSTOCKS exported functions refused test_target_signature with Date in the signature; + 2 self-zone (S1, S2) |
| TEST_CASE_EXISTING v3b: Uint8Array / Map / Set / Record | 0 | 25 bytes + 15 Map/Set + 13 Record/unknown = 53 PeaceSTOCKS functions |
| (already live) TEST_CASE_EXISTING v1/v2 | 1 (TEST_CASE seq 26, kind-adjacent) | 78 v2-eligible PeaceSTOCKS functions, 18 with no direct call in src/*.test.ts (grep heuristic; some are tested indirectly); + 5 self-zone (S3-S7, drafted) |
| planner family (COMPLEX/LOOP with object params, module constants) | 5 (seq 8, 12, 17, 19, 22) | not measured |
| replace-expression on more files (EDITABLE_PATHS, protected) | 0 | 1 real bug found (Workspace src/text.ts truncate, S8); PeaceSTOCKS: none known |
| DOC_PAGE (peaceai/docs/*.md, already safe zone) | 0 | 1+ (verdict PR route doc; self-zone doc refresh) |
| READ_ONLY_OPS (approved) | 2 of 13 OPS_ACTION | n/a |
| PEACEAI_SELF_CHANGE beyond stage 1 | 25 | stays protected by design |
Signature census (180 test_target_signature refusals on v2): named interface not plain-data/other 80, Date 39, bytes 25, Map/Set 15, Record/unknown 13, function-typed 3, async/io 3, inferred return 2 (sig.mts).

## Items
| # | item | source | class | why |
|---|---|---|---|---|
| 1 | S3 plural characterization (helpers/text.ts) | self-zone scan | a | v1, Job B COUNTS, test in peaceai/self-tests/helpers (inSafeZone) |
| 2 | S4 helper truncate characterization | self-zone scan | a | v1, COUNTS, safe zone |
| 3 | S5 src/text truncate (maxLength <= 1 branch) | self-zone scan | a | v1, COUNTS, new src test (ordinary scope) |
| 4 | S6 slugify empty/punctuation | self-zone scan | a | v1, COUNTS |
| 5 | S7 parseQuantity decimals/zero/padding/exponent | self-zone scan | a | v1, COUNTS |
| 6 | S1/S2 utcDayKey, minutesOfUtcDay | self-zone scan | b | Date parameter: test_target_signature on v1 and v2 |
| 7 | TEST_CASE_EXISTING wider data signatures (bytes/Map/Set/Record) | census | b | new spec version |
| 8 | ENV_FIX presence reads (stress E1) | stress gap 9 | b | spec variant |
| 9 | multi-file refactor / async / deps / classes / debugging (N1, N3-N12, N14) | stress | b | each its own design |
| 10 | DOC_PAGE skill for peaceai/docs (e.g. verdict PR route page) | RESUME/#398 | b | path is safe zone; no doc-writing skill |
| 11 | stress grader stub placement (gap 3) | gaps.md | b | tooling on notes/stress-v1, not on main; needs a tools zone + body edit |
| 12 | refusal line 5-entry cap hides the relevant reason (S8, #386) | this triage | b | refusal-reason.ts is not protected but outside the safe zone |
| 13 | gap 1 objects nested in array args | gaps.md | c | learned-test.ts / learned-test-existing.ts (generation and grading) |
| 14 | gap 2 undefined-only checks graded COUNTS | gaps.md | c | Job B grading |
| 15 | gap 4 control characters in task text (#397) | gaps.md | c | taskmap.ts (issue cleaning, protected M46) |
| 16 | widen replace-expression EDITABLE_PATHS (src/text.ts) | S8 | c | learned-body.ts protected; after it, S8 becomes (a) |
| 17 | S8 truncate negative limit returns longer text (real bug) | self-zone scan | c (blocked by 16) | refused today: src/text.ts not in EDITABLE_PATHS |
| 18 | kernel families K1/K2/K5 | stress gap 5 | c | core repo |
| 19 | plain wording to learned families (A4) | stress gap 8 | c | nlparse feeds every trigger |
| 20 | PR #265 builder-log un-drop seq 106-114 | open PR | c | MERGEABLE/CLEAN, base builder-log-255-259-262, last update 2026-10-16; seq 106-114 already on main: likely superseded (close needs Peace) |
| 21 | PR #163 M44 set C task rule | open PR | c | CONFLICTING, 2026-10-15, peaceai/model (protected) |
| 22 | PR #133 M24 workflow trigger trim | open PR | c | CONFLICTING, 2026-10-14, nlparse/selfchange |
| 23 | PR #115 M22 skill learner | open PR | c | CONFLICTING, 2026-10-14, workflow + lib |
| 24 | stale remote branches (m73/read-only-ops-enable, m72/self-zone-enable/-v2, m86/gaps-batch-v5) | RESUME | c | deletion needs Peace |
| 25 | confirm results-crosscheck on main after #398 | RESUME | c | Builder ops |
Closed since the lists were written (not counted): stress gaps 1, 2, 3, 6, 7 (#377, #378 and the three approved specs), protected-path refusal reason (#347), TEST_CASE on untested helpers (TEST_CASE_EXISTING), IMPORT_EDIT/TSCONFIG no target (no work), L3 while-loop (refuse by design).
Counts: a 5, b 7, c 13.

## Next skills that move the most (b) into (a)
1. TEST_CASE_EXISTING v3 with Date arguments/returns (date-literal args already exist in the M35 grammar): S1, S2 + 39 PeaceSTOCKS functions. Bundle gap 1 (array-nested object args) in the same engine PR (c work).
2. TEST_CASE_EXISTING v3b for Uint8Array/Map/Set/Record: 53 PeaceSTOCKS functions.
3. DOC_PAGE for peaceai/docs (safe zone already): first skill where PeaceAI writes about its own behavior; plus widening EDITABLE_PATHS (c, one protected PR) turns S8 into (a).
