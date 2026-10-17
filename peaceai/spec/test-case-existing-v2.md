# TEST_CASE_EXISTING v2 (`public-test-case-existing-v2`, M85)

Stress test v1 (notes/stress-v1) gaps 1 and 7: v1 (`public-test-case-existing-v1`) refuses most of PeaceSTOCKS's
untested exported functions because their signatures use plain-data object types (`test_target_signature`) or
they import a helper from a sibling module (`test_target_impure`). v2 is a NEW spec with its own hash; v1 and its
behavior are unchanged.

## Shape

Same trigger, check grammar, output (one new test file next to the module, importing only the named function) and
fix-free grading as v1. Only `params.target` differs: `exported-pure-function-v2`.

- Signature: each parameter and the return may also be a plain-data type: string / number / boolean literal types
  and unions of them with `null` / `undefined`; object type literals of property signatures only; a module-local
  non-generic interface (no `extends`) or type alias of that shape; a module enum; a named import of such a type /
  enum from a relative sibling (followed); arrays and `readonly` arrays of these. Nesting depth <= 3, <= 16 members. Tuples, function types, classes,
  generics and index signatures stay refused (`test_target_signature`).
  Generics, function / method members, index signatures, `Date`, `Map`, `any`, `unknown` stay `test_target_signature`.
- Sibling imports: a named value import from a relative specifier (`./x`, `../x`, `.js` -> `.ts`) that resolves to
  exactly one plain, unprotected, non-test, non-declaration `.ts` module (<= 64 KiB) is followed: the imported name
  must be a function or const the sibling itself declares and exports (no re-exports, default or namespace imports),
  and it is analyzed with the same purity rules in the sibling's own module context. At most 4 sibling modules,
  import depth 2 (`test_target_too_large` past that). Packages and Node builtins are refused by name as in v1.
- Checks may pass object literals (the M20 bounded plain-data grammar).
- `not_needed`: a target v1 accepts is left to v1, so the two specs never both answer one task.

## Grading

Job B re-checks the target under the v2 analysis on the real tree (sibling reads limited to in-scope non-test
source files) only for a candidate whose operation id names `public-test-case-existing-v2`; every other candidate is
re-checked under v1 exactly as before. The stub returns `{}` for a plain-data object return (v2 only), so the
fail-with-stub step stays an assertion failure. The confined read closure already includes relative imports.

## Evidence

`peaceai/rules/proposals/m85-test-case-existing-v2-evidence.json`: 13 commits from 7 permissive repos outside the
training corpus that change only test files and add or extend a test calling an existing exported function that v1
refuses and v2 accepts on the module at the parent commit (10 for the signature, 3 needing a followed sibling
import). Target and followed sibling modules are blob-pinned fixtures under `peaceai/test/fixtures/m85-te2/`,
listed in THIRD_PARTY_NOTICES. Peace's public repos were checked first: PeaceSTOCKS has two fitting functions and
PeaceAI-Workspace none; both are in the corpus manifest, so none count.
