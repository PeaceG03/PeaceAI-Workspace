# COMPLEX calls/callbacks v1 (`public-complex-calls-v1`, M85)

Stress test v1 (notes/stress-v1) gap 6: COMPLEX / LOOP bodies could not call the target module's own helpers
(`padAll` calling `pad2`, task L4), pass an arrow to an array method (`csv.split(",").map((s) => s.trim())`, task C3),
or keep a template literal (task C4; fixed separately in issue cleaning). Auditor #219 kept module helpers uncallable
for the existing specs; this is a NEW spec with its own hash, so those specs are unchanged.

## Shape

- Trigger: `add complex function NAME(TYPED PARAMS): TYPE to FILE with body:` or `add loop function ...` (the same
  signature grammar: string / number / boolean and their arrays, up to 4 parameters), then the body lines, then
  check bullets (`- CALL is VALUE`, `- CALL equals [..]`, `- CALL throws CODE`).
- Params: the COMPLEX keys with `loops: ["counted-literal-or-length", "for-of-param"]` (public-loop-function-v1's
  bounded loops; `while` stays `loop_while_unsupported`) plus the pair, always together:
  - `calls: "module-exported-pure"`: the new body is vetted inside the whole target module (the module text with the
    function appended). A call to a module function is allowed only when it is exported, top level, one declaration
    with a body, not async / generator / default / generic, with plain typed parameters, and its own body passes this
    same vocabulary; call depth <= 2; no recursion (Option A's callee check, unchanged).
  - `callbacks: "array-method-arrow"`: an arrow function only as the single argument of `.map`, `.filter`, `.some`,
    `.every`, `.find` or `.findIndex` (no `?.`, no type arguments), with exactly one plain identifier parameter
    (optionally typed from the vocabulary, never shadowing), an expression body vetted by the same vocabulary, no
    nested function. At most 4 per expression. Every other function-like node stays refused.
- `not_needed`: a task whose body uses neither a module call nor a callback is refused, so this spec never answers
  a task another COMPLEX spec answers.
- `__peaceai*` names are refused (the vetting replaces each arrow with a reserved placeholder).

## Grading

Unchanged: Job B grades the candidate against itself (the new test passes with the function and fails with the
module put back to the task base). The callees already existed at the base, so the before-run fails because the
new function is gone.

## Evidence

`peaceai/rules/proposals/m85-complex-calls-evidence.json`: 11 exported functions from 3 pinned example-only
permissive trees (m45 pins: lerna, pnpm, storybook), each passing the extended vocabulary, using it, and refused by
the plain vocabulary on the same text. Peace's public repos were checked first (PeaceSTOCKS 0 fits; PeaceAI-Workspace
1, lib/stacked.ts provenanceClause) and do not count (corpus manifest). Fixtures under
`peaceai/test/fixtures/m85-calls/`, listed in THIRD_PARTY_NOTICES.
