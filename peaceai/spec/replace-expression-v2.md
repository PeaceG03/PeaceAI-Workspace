# REPLACE_EXPRESSION v2 (`public-replace-expression-v2`, M85)

Stress test v1 (notes/stress-v1) gap 4: edit an existing function body (a bounded bug fix). The engine
(`peaceai/lib/learned-body.ts`, M27, Auditor #136 rounds 1-3) is wired in Job A and Job B but has had no spec since
its evidence fell to 5/27 fits on Peace's own commits (below the bar of 10). v2 is a NEW spec id with the same params
and engine; the evidence now comes from licensed external repos outside the training corpus.

## Shape (unchanged engine)

- Trigger: `in FN in FILE: replace condition OLD with NEW` or `... replace return OLD with NEW`, then check bullets.
- Exactly one site: the condition of one `if (...)` or the value of one `return ...;` among the uniquely named
  exported function's own statements (never inside a nested function), matched token by token.
- NEW uses only OLD's own names, the function's parameters and its const/let locals declared before the site, the
  fixed pure operator / built-in vocabulary, and callees OLD already calls (with any arguments). No assignment,
  `new`, closures, element access, spread, optional chaining, `__proto__` / `constructor` / `prototype`; a condition
  may not become constant; NEW must differ from OLD.
- `paths: allow-listed-leaf-modules`: the edit is refused outside the per-repo EDITABLE_PATHS allow-list (8
  PeaceSTOCKS leaf modules, 4 Workspace demo modules). The list is not widened in this batch.

## Grading (unchanged)

Job B: the new test passes with the edit and fails with the source put back to the task base, by assertion
failures only (never a crash, load error or other throw).

## Evidence

`peaceai/rules/proposals/m85-replace-expression-v2-evidence.json`: non-merge commits in permissive repos outside the
training corpus that change 1-2 non-test `.ts` files and whose single hunk replaces exactly one `if (...)` line or
`return ...;` line by one of the same kind in an exported function, where the engine's own site and vocabulary
checks (`replaceSite`, minus the allow-list, which is per target repo) accept the edit on the parent's text. Parent
modules are blob-pinned fixtures under `peaceai/test/fixtures/m85-replace/`, listed in THIRD_PARTY_NOTICES.
