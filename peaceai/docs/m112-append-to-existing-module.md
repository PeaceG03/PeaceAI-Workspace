# M112: append a derived function to an existing module (public-derive-from-behavior-v3)

Gap: DERIVE_FROM_BEHAVIOR v1/v2 can only CREATE one new module holding one function and its test. A family of small
related functions (the PeaceSTOCKS health slice 1, #513-#516) therefore became four one-function modules.

Change: a new rule version, `public-derive-from-behavior-v3` (rule param `placement: end-of-existing-module`, trigger
`DERIVE_APPEND_TRIGGER`), proposal record `peaceai/rules/proposals/public-derive-from-behavior-v3.json`, spec section in
`peaceai/spec/derive-from-behavior-v1.md`. It extends the existing engine (same search: v1 first, then v2's label chains;
same vocabulary, size bound, witness / form / domain gates and refusals); it only changes WHERE the function goes.
v1 and v2 are unchanged (same specs and hashes; in `new-module` placement the same code path).

Issue phrasing (header line):

    Append a new function `name(a: number, b: number): boolean` to the existing module `src/path/module.ts`.

followed by behavior prose and literal examples, exactly as for v1.

## The edit

- The new module text is the old text, one blank line, then the derived function. Nothing else changes: no import is
  added, removed or reordered, no old line moves. `derivedAppendProblem` re-checks this (old text is a prefix, the
  statement count grows by exactly one, every old statement's text is unchanged, the new block passes the v1 module
  check). One new test file, as in v1, imports the function from the module and asserts every example.
- Job A (generate.ts) needed no change: it already takes a non-create edit with an extra new test file.
- Job B (test-candidates.ts) accepts a derive candidate that either creates one module (v1/v2) or modifies exactly one
  existing source file (v3). For v3 it reads the module's text at the base commit, re-runs `derivedAppendProblem` and
  `appendTargetProblem` against it, and runs the module's existing tests and the new test confined (Node >= 22
  permission model) to the module's import closure. Anything else is `not-test-only`.
- The review note is rebuilt from the diff: one hunk that only adds lines at the end of one existing file, plus one new
  test file, and nothing else.

## Refusals (checked before the search; every v1/v2 refusal still applies)

| refusal | when |
|---|---|
| `target_file_not_found` | the named module does not exist (exact path; a case near-miss is not a match). v3 never creates a module |
| `derive_path` | not a plain `src/**/*.ts` path, a protected path (approval / token / secret / gate ...), a test, `.d.ts`, fixture, excluded or self-protected path |
| `denied_path` | the target repo's deny patterns (applyRule, unchanged) |
| `derive_append_layout` | CRLF, no final newline, a trailing blank line, or an empty module (the append would have to touch existing text) |
| `derive_append_parse` | the module does not parse |
| `derive_append_name_collision` | the name appears anywhere in the module (any binding, import, export, type, property, use, even a comment: fail closed), or the module has `export *` / `export * as` |
| `derive_append_mutable_state` | a top-level `let`, `var` or `using` |
| `derive_append_side_effects` | the module or anything it imports runs code at import (top-level calls, clock / env reads, static blocks, `export default` of an expression), imports a package, or has an unresolved import (the M-edit-existing `loadClosure` / `loadProblem` checks), or any top-level initializer in the import closure fails the strict inert-at-load allowlist (`importTimeProblem`, see below) |
| `derive_append_not_add_only` | the built text is not old text + blank line + one function (re-check) |
| `derive_params` | a spec pairing a placement with the other placement's trigger |

`not_needed` (v2: "v1 already derives this") does not apply to appends: v1 cannot append, so v3 answers with the v1
search first, then label chains.

## Held-out results (peaceai/test/m112-derive-append-existing-module.test.ts)

Written before they were first run, not used to build the engine; appended to a realistic module (type import, value
import, frozen table, constant, interface, class, two functions):

| spec | first written | after the examples the refusals asked for | appended body |
|---|---|---|---|
| isOverBudget(spent, budget) | `derive_under_specified_far: spent` | 2 examples added | `!(spent <= budget)` |
| tagLine(name, level) | `derive_budget` (see below), then `derive_under_specified_chars: level` | 2 examples added | `"[" + level + "] " + name` |
| isLongRun(minutes) | `derive_under_specified_far: minutes`, then `..._region: minutes` | 4 examples added | `45 <= minutes` |
| lightColor(stop, slow) | appended (v2 label chain) | - | `stop ? "RED" : (slow ? "AMBER" : "GREEN")` |

Each equals its spec on probes outside the examples; all four appended in sequence to ONE module; the module's own
test and all four new tests pass, and each new test fails before its append. tagLine's example `" x "` was first
written with a double space in its result; issue-text cleaning collapses runs of spaces, so the examples became
inconsistent and the search ran out of budget (a refusal, not a wrong program). It was rewritten as `"x "`; this is a
pre-existing v1 limit, recorded in the test.

Negatives (all refused with the names above): collisions (8 forms + a comment), mutable state (3), import-time code (8,
incl. a side effect in an imported sibling, a package import, an unresolved import, a static block), protected /
denied / test / fixture / traversal paths (16; never-zone paths such as `.github/`, `peaceai/` cannot even be phrased,
the trigger names `src/` only), a missing module and a case near-miss, layout (5) and parse, and the v1 gates through
v3 (under-specified, code in the prose, existing test path).

Seeded random (seed 112, 60 tasks on random existing modules): 0 wrong programs, every candidate add-only, every
injected collision refused.

## Can slice-1-style functions share one module?

Yes, in the tests: a slice-1-shaped family (a pipe-joined line, a two-number silence check, a one-number window check,
a two-boolean state word) is created by v1 (first function) and then extended three times by v3 (applyRule with repo
PeaceG03/PeaceSTOCKS, so its deny patterns apply); one module, four functions, every test passes. Most of these needed
the extra examples the v1 gates ask for (recorded in the test).

Offline dry run (disclosed; not committed, nothing filed, PeaceSTOCKS not modified): the real slice-1 issue texts, the
first retargeted to one module path and the other three rephrased with the append header, run against a scratch copy of
the PeaceSTOCKS checkout: v1 created the module, v3 appended the other three; all four tests passed and the module
type-checked under strict. So the four tiny modules of slice 1 could have been one.

## Limits

- One function per issue, a single return expression from the v1/v2 vocabulary (no statements, no helpers).
- Imports are never added; a function that needs a symbol the module does not already import cannot be appended
  (it is derived only from its own parameters anyway).
- The name check is textual and fails closed: the name in a comment or string anywhere in the module refuses.
- A module ending with a blank line, CRLF or no final newline is refused rather than normalized.
- Job B grades a derive candidate only on Node >= 22 (permission model), as for v1/v2; CI runs Node 22.
- Off until Peace approves the v3 hash on its proposal issue.

## Strict inert-at-load (Auditor #520)

The hermetic walk `loadProblem` / `reachProblem` is shallow: it never looks inside a function, so an initializer that
CALLS one ran code at import unseen (`export const a = (() => fetch("x"))();`, an IIFE reading `process.env`, writing
`globalThis` or logging, `console.log(1)`, a custom tagged template), as did one that makes the runtime call user code
(a getter by member access or destructuring, `toString` / `valueOf` by a template or arithmetic, an iterator by a
spread or `new Set(name)`), in the module or in any module it imports. `loadProblem` now also runs `importTimeProblem`
(peaceai/lib/learned-edit-existing.ts) on every module of the closure: every top-level variable initializer, enum member
initializer, static field initializer and `export default` expression must pass a strict allowlist, else
`edit_module_load:<path>` (here `derive_append_side_effects`). Allowed: literals (regex too), `undefined`, a plain name
bound at top level in the closure, a function or arrow that is not invoked, array literals (no spread, no hole) and
object literals (plain / string / number keys, no computed key, spread, getter / setter or `__proto__`; methods allowed)
of allowed parts, an untagged template or `+ - * / % **` over primitives only (literals, or names of top-level consts
whose initializer is primitive), `as` / `satisfies` / `!` / parens, and on fresh literals only, with the global not
rebound anywhere in the closure, `Object.freeze(literal)` and `new Set` / `new Map(array literal)`. Destructuring
declarations and `using` are refused. Everything else (any other call or `new`, member access, tagged template,
conditional, `typeof`, `await`, class expression) is refused: fail closed. The same check applies to EXISTING_EDIT
(not approved; its splice entry is disabled) through the shared `loadProblem`; one of its 15 G2 evidence closures
(pete-mc/dataverse-powertools, `"/".charCodeAt(0)` at import) is now refused and recorded as such in
m98-existing-function-edit.test.ts (14 accepted, bar 10). The negatives for each case are in the import-time test.
