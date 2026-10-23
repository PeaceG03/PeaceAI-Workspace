# M99 DERIVE_FROM_BEHAVIOR: mutation proof (Auditor #491 B1 / B2)

Each row is one mutant: a single text replacement in the named file, applied to a clean tree; the m99 test files
(m99-derive-gates, m99-derive-guards, m99-derive-from-behavior) are then run on Node 22. KILLED lists the tests that
failed on the mutant (each passes on the unmutated tree). Harness: one replacement per run, the tree is restored after.

| # | mutant | file | result | killed by |
|---|---|---|---|---|
| 1 | B1 gate call in deriveProgram | `peaceai/lib/derive.ts` | KILLED | B1 repro: S1 without "600 gives false" is refused (gate far), not derived as `(status === 429) \|\| (500 <= status)`; gate rival (size + 2): near pass (every example value a constant, probes inside the examples) and far pass (witnessed edges, far probes past them); refusal through the rule names the gate and the parameter; the detail says what to add |
| 2 | B1 unread | `peaceai/lib/derive.ts` | KILLED | gate unread: a parameter the program ignores needs two examples differing only in it with the same result |
| 3 | B1 chars | `peaceai/lib/derive.ts` | KILLED | gate chars: a string parameter that is read needs upper, lower, digit, inner space, edge space and punctuation |
| 4 | B1 edge p===c: c-1 | `peaceai/lib/derive.ts` | KILLED | gate edge: both sides of every threshold, and c - 1, c, c + 1 for an equality |
| 5 | B1 edge p===c: c+1 | `peaceai/lib/derive.ts` | KILLED | gate edge: both sides of every threshold, and c - 1, c, c + 1 for an equality |
| 6 | B1 edge p<=c both sides | `peaceai/lib/derive.ts` | KILLED | gate edge: both sides of every threshold, and c - 1, c, c + 1 for an equality |
| 7 | B1 edge c<=p both sides | `peaceai/lib/derive.ts` | KILLED | gate edge: both sides of every threshold, and c - 1, c, c + 1 for an equality |
| 8 | B1 edge range lo | `peaceai/lib/derive.ts` | KILLED | gate edge: both sides of every threshold, and c - 1, c, c + 1 for an equality |
| 9 | B1 edge range hi | `peaceai/lib/derive.ts` | KILLED | gate edge: both sides of every threshold, and c - 1, c, c + 1 for an equality |
| 10 | B1 edge p vs q (deltas) | `peaceai/lib/derive.ts` | KILLED | gate edge: both sides of every threshold, and c - 1, c, c + 1 for an equality |
| 11 | B1 edge emptiness | `peaceai/lib/derive.ts` | KILLED | gate edge: both sides of every threshold, and c - 1, c, c + 1 for an equality |
| 12 | B1 far: past the last edge | `peaceai/lib/derive.ts` | KILLED | B1 repro: S1 without "600 gives false" is refused (gate far), not derived as `(status === 429) \|\| (500 <= status)`; gate far: an example at least DERIVE_FAR (100) past the last edge and before the first; refusal through the rule names the gate and the parameter; the detail says what to add |
| 13 | B1 far: before the first edge | `peaceai/lib/derive.ts` | KILLED | gate far: an example at least DERIVE_FAR (100) past the last edge and before the first |
| 14 | B1 far: p - q deltas (both) | `peaceai/lib/derive.ts` | KILLED | gate far: an example at least DERIVE_FAR (100) past the last edge and before the first |
| 15 | B1 far: p - q >= DERIVE_FAR side | `peaceai/lib/derive.ts` | KILLED | gate far: an example at least DERIVE_FAR (100) past the last edge and before the first |
| 16 | B1 far: p - q <= -DERIVE_FAR side | `peaceai/lib/derive.ts` | KILLED | gate far: an example at least DERIVE_FAR (100) past the last edge and before the first |
| 17 | B1 branch/cap check | `peaceai/lib/derive.ts` | KILLED | gate branch / cap: each branch and each side of a cap is reached by at least DERIVE_MIN_REACH (2) examples |
| 18 | B1 DERIVE_MIN_REACH 2 -> 1 | `peaceai/lib/derive.ts` | KILLED | gate branch / cap: each branch and each side of a cap is reached by at least DERIVE_MIN_REACH (1) examples |
| 19 | B1 rival gate call | `peaceai/lib/derive.ts` | KILLED | gate rival (size + 2): near pass (every example value a constant, probes inside the examples) and far pass (witnessed edges, far probes past them) |
| 20 | B1 rival near pass | `peaceai/lib/derive.ts` | KILLED | gate rival (size + 2): near pass (every example value a constant, probes inside the examples) and far pass (witnessed edges, far probes past them) |
| 21 | B1 rival far pass | `peaceai/lib/derive.ts` | KILLED | gate rival (size + 2): near pass (every example value a constant, probes inside the examples) and far pass (witnessed edges, far probes past them) |
| 22 | B1 rival size+2 -> size+0 | `peaceai/lib/derive.ts` | KILLED | gate rival (size + 2): near pass (every example value a constant, probes inside the examples) and far pass (witnessed edges, far probes past them) |
| 23 | B1 rival_budget refusal | `peaceai/lib/derive.ts` | KILLED | gate rival (size + 2): near pass (every example value a constant, probes inside the examples) and far pass (witnessed edges, far probes past them) |
| 24 | B1 rival far: negative probes only if shown | `peaceai/lib/derive.ts` | KILLED | gate rival (size + 2): near pass (every example value a constant, probes inside the examples) and far pass (witnessed edges, far probes past them) |
| 25 | B1 refusal code names the gate | `peaceai/lib/learned-derive.ts` | KILLED | refusal through the rule names the gate and the parameter; the detail says what to add |
| 26 | B1 review note: re-derived expr must equal module | `peaceai/lib/learned-derive.ts` | KILLED | review note: a DERIVE candidate shows its expression and far-probe outputs, rebuilt from its diff; anything else gets none |
| 27 | B1 review note: literal test lines only | `peaceai/lib/learned-derive.ts` | KILLED | review note: a DERIVE candidate shows its expression and far-probe outputs, rebuilt from its diff; anything else gets none |
| 28 | B1 review note: one module + one test | `peaceai/lib/learned-derive.ts` | KILLED | review note: a DERIVE candidate shows its expression and far-probe outputs, rebuilt from its diff; anything else gets none |
| 29 | B1 review note rendered as written | `peaceai/lib/review.ts` | KILLED | review note: a DERIVE candidate shows its expression and far-probe outputs, rebuilt from its diff; anything else gets none; reserved names: a parameter or function named eval, arguments or globalThis is derive_reserved_name |
| 30 | B1 reserved parameter names | `peaceai/lib/learned-derive.ts` | KILLED | reserved names: a parameter or function named eval, arguments or globalThis is derive_reserved_name |
| 31 | B1 reserved function name | `peaceai/lib/learned-derive.ts` | KILLED | reserved names: a parameter or function named eval, arguments or globalThis is derive_reserved_name |
| 32 | B2 Job B derivedModuleProblem | `peaceai/bin/test-candidates.ts` | KILLED | Job B derive: the untouched candidate COUNTS; a module that is not exactly a derived function is not-test-only |
| 33 | B2 Job B zone re-runs (all) | `peaceai/bin/test-candidates.ts` | KILLED | Job B derive: the new tests are re-run in UTC, America/Denver and Asia/Tokyo, confined; a zone-dependent or fs-reading test is real-not-stable |
| 34 | B2 Job B zone re-runs: drop Asia/Tokyo | `peaceai/bin/test-candidates.ts` | KILLED | Job B derive: the new tests are re-run in UTC, America/Denver and Asia/Tokyo, confined; a zone-dependent or fs-reading test is real-not-stable |
| 35 | B2 Job B zone re-runs: drop America/Denver | `peaceai/bin/test-candidates.ts` | KILLED | Job B derive: the new tests are re-run in UTC, America/Denver and Asia/Tokyo, confined; a zone-dependent or fs-reading test is real-not-stable |
| 36 | B2 Job B zone re-runs: drop UTC | `peaceai/bin/test-candidates.ts` | KILLED | Job B derive: the new tests are re-run in UTC, America/Denver and Asia/Tokyo, confined; a zone-dependent or fs-reading test is real-not-stable |
| 37 | B2 Job B --permission (zone runs) | `peaceai/bin/test-candidates.ts` | KILLED | Job B derive: the untouched candidate COUNTS; a module that is not exactly a derived function is not-test-only |
| 38 | B2 generate.ts:286 raw-issue check | `peaceai/bin/generate.ts` | KILLED | Job A: code hidden where cleaning drops it (``` / ~~~ fences, HTML comments, indented code) refuses the derive rule; the clean issue makes a candidate |
| 39 | B2 raw issue: fences | `peaceai/lib/learned-derive.ts` | KILLED | Job A: code hidden where cleaning drops it (``` / ~~~ fences, HTML comments, indented code) refuses the derive rule; the clean issue makes a candidate |
| 40 | B2 raw issue: ~~~ only | `peaceai/lib/learned-derive.ts` | KILLED | Job A: code hidden where cleaning drops it (``` / ~~~ fences, HTML comments, indented code) refuses the derive rule; the clean issue makes a candidate |
| 41 | B2 raw issue: HTML comment | `peaceai/lib/learned-derive.ts` | KILLED | Job A: code hidden where cleaning drops it (``` / ~~~ fences, HTML comments, indented code) refuses the derive rule; the clean issue makes a candidate |
| 42 | B2 raw issue: indented code | `peaceai/lib/learned-derive.ts` | KILLED | Job A: code hidden where cleaning drops it (``` / ~~~ fences, HTML comments, indented code) refuses the derive rule; the clean issue makes a candidate |
| 43 | B2 DERIVE_BUDGET stop | `peaceai/lib/derive.ts` | KILLED | budget: the search stops at the caller's budget, and a larger budget is clamped to DERIVE_BUDGET; constant programs: the filtered search finishes S1 and S2 within the programs they need (unfiltered: derive_budget) |
| 44 | B2 DERIVE_BUDGET clamp | `peaceai/lib/derive.ts` | KILLED | budget: the search stops at the caller's budget, and a larger budget is clamped to DERIVE_BUDGET |
| 45 | B2 MAX_KEPT_CELLS check (`keptCells += P` with no bound) | `peaceai/lib/derive.ts` | KILLED | memory: the kept-values bound stops the search (derive_budget); a caller's bound is clamped to MAX_KEPT_CELLS (assertion: S1 under a 20 000-value bound derives instead of derive_budget); the older many-points memory test crashes on heap |
| 46 | B2 size clamp 13 | `peaceai/lib/derive.ts` | KILLED | size: maxSize above DERIVE_MAX_SIZE (13) searches exactly what 13 does |
| 47 | B2 emit: size cap | `peaceai/lib/learned-derive.ts` | KILLED | emit checks: size cap (derive_emit_size), then body vocabulary (derive_expr_vocab), then the strict allowlist |
| 48 | B2 emit: body vocabulary | `peaceai/lib/learned-derive.ts` | KILLED | emit checks: size cap (derive_emit_size), then body vocabulary (derive_expr_vocab), then the strict allowlist |
| 49 | B2 emit: strict allowlist | `peaceai/lib/learned-derive.ts` | KILLED | emit checks: size cap (derive_emit_size), then body vocabulary (derive_expr_vocab), then the strict allowlist |
| 50 | B2 constant-program filter | `peaceai/lib/derive.ts` | KILLED | constant programs: the filtered search finishes S1 and S2 within the programs they need (unfiltered: derive_budget) |
| 51 | B2 MAX_KEPT_CELLS clamp (`keptCellsLimit` returns the caller's value) | `peaceai/lib/derive.ts` | KILLED | memory: the kept-values bound stops the search (derive_budget); a caller's bound is clamped to MAX_KEPT_CELLS |
| 52 | B2 main search ignores the bound it is given (`cells: MAX_KEPT_CELLS`) | `peaceai/lib/derive.ts` | KILLED | memory: the kept-values bound stops the search (derive_budget); a caller's bound is clamped to MAX_KEPT_CELLS |

52 mutants, 52 killed, 0 survived.

Notes:

- One earlier p - q far mutant (`false && A || B`) left the gate in place, so it could not fail; it is replaced by the three p - q rows above (both sides, and each side alone).
- B2 MAX_KEPT_CELLS: first killed only by the guards file running out of heap. The bound is now a clamped input (`maxKeptCells`, never above MAX_KEPT_CELLS, via keptCellsLimit), so removing the check, the clamp, or the main search's use of it each fails an assertion. Not covered on its own: the rival search ignoring the caller's bound (it then runs under MAX_KEPT_CELLS itself, still bounded).
- The `not-confined` path in gradeSelf (Node below the permission-model major) cannot be reached on Node 22, the only Node version CI and the box run. It is guarded by the version check alone.
- The wiring in peaceai/bin/review-comment.ts is now tested end to end (round 2, B3: section below).

## Auditor #491 round 2, B3: the review hook, end to end (head 8004623, Node 22, m99-derive-review-hook.test.ts)

The hook test runs peaceai/bin/review-comment.ts as a process on a candidates dir (a DERIVE candidate built from S1, plus
a plain edit) and reads the comment it writes.

| # | mutant | file | result | killed by |
|---|---|---|---|---|
| H1 | attach - tag check | `peaceai/lib/learned-derive.ts` | KILLED | review-comment.ts end to end: the DERIVE note (expression + far-probe table) lands on the DERIVE candidate, above its diff, and nowhere else; review-comment.ts fails closed: a DERIVE candidate with a placeholder note, or whose note cannot be rebuilt, stops the job (no comment written); attachDeriveNotes / assertDeriveNotesShown: each refusal on its own |
| H2 | attach - existing (placeholder) note throws | `peaceai/lib/learned-derive.ts` | KILLED | review-comment.ts fails closed: a DERIVE candidate with a placeholder note, or whose note cannot be rebuilt, stops the job (no comment written); attachDeriveNotes / assertDeriveNotesShown: each refusal on its own |
| H3 | attach - existing note overwritten silently | `peaceai/lib/learned-derive.ts` | KILLED | attachDeriveNotes / assertDeriveNotesShown: each refusal on its own |
| H4 | attach - null rebuild throws | `peaceai/lib/learned-derive.ts` | KILLED | review-comment.ts fails closed: a DERIVE candidate with a placeholder note, or whose note cannot be rebuilt, stops the job (no comment written); attachDeriveNotes / assertDeriveNotesShown: each refusal on its own |
| H5 | assert - body check | `peaceai/lib/learned-derive.ts` | KILLED | attachDeriveNotes / assertDeriveNotesShown: each refusal on its own |
| H6 | assert - no-op | `peaceai/lib/learned-derive.ts` | KILLED | attachDeriveNotes / assertDeriveNotesShown: each refusal on its own |
| H7 | review-comment attach call | `peaceai/bin/review-comment.ts` | KILLED | review-comment.ts end to end: the DERIVE note (expression + far-probe table) lands on the DERIVE candidate, above its diff, and nowhere else; review-comment.ts fails closed: a DERIVE candidate with a placeholder note, or whose note cannot be rebuilt, stops the job (no comment written) |
| H8 | review.ts drops multi-line notes | `peaceai/lib/review.ts` | KILLED | review-comment.ts end to end: the DERIVE note (expression + far-probe table) lands on the DERIVE candidate, above its diff, and nowhere else |
| H9 | review-comment assert call (alone) | `peaceai/bin/review-comment.ts` | SURVIVED | (none: see note) |
| H10 | review-comment assert call + review.ts drop | `peaceai/bin/review-comment.ts + peaceai/lib/review.ts` | KILLED | review-comment.ts end to end: the DERIVE note (expression + far-probe table) lands on the DERIVE candidate, above its diff, and nowhere else |

10 mutants, 9 killed, 1 survived.

- H9 (the `assertDeriveNotesShown` call removed on its own) survives by design: it is a second layer behind review.ts
  rendering the note. Nothing else on the path drops a note, so removing only the check changes no output. H10 drops
  the note in review.ts too, and the end-to-end test catches it, so a lost note never lands silently.

## Round 3: span sign gate (m100 practice floor_clamp; Node 22, gates + ask + mistakes tests)

| # | mutant | file | result | killed by |
|---|---|---|---|---|
| S1 | sign: the "nothing at 0 or below" branch removed | `peaceai/lib/derive.ts` | KILLED | gate span: a computed-from parameter shown over DERIVE_FAR; every result sign the program reaches is shown; mistakes ledger: replayed (m100-floor-unshown) |
| S2 | sign: the "negative, but not DERIVE_FAR below 0" branch removed | `peaceai/lib/derive.ts` | KILLED | gate span: a computed-from parameter shown over DERIVE_FAR; every result sign the program reaches is shown |
| S3 | sign: `beyond` always true (asks even where a shown floor keeps the result flat) | `peaceai/lib/derive.ts` | KILLED | unwitnessed cap: the span refusal asks past the shown stretch; gate span; mistakes ledger: replayed |

3 mutants, 3 killed.
