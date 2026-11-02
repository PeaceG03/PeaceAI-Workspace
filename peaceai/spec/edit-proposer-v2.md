# General edit proposer v2 (M168, repair-v2)

repair-v2 is an opt-in second mode of the M152 edit proposer (peaceai/lib/editpropose.ts,
`repairProposer({ v2: true })`, `tsx peaceai/bin/loop.ts run <taskfile> --proposer repair-v2`). It keeps every
repair-v1 rule (spec/edit-proposer-v1.md: locate, templates, combine, dedupe, stop-unsafe, caps) and adds three
general things in front of them. repair-v1 (the default `repairProposer()`) and model-v1 (which ranks repair-v1's
candidate list and binds it by candidatesSha256) are unchanged: same templates, same order, same locate.

## Why these three (diagnosis on the public dev split only)

The repair-v1 dev rows in plan/loop-runs.jsonl (plan-only-v3, --max 20) solve 0 of the 12 public dev tasks; rules-v1
also solves 0. Reading the public reference diffs of the tasks that ran tests showed three gaps that are not specific
to any one repository:

1. Edit kinds. Every repair-v1 template changes one token (an operator, a literal, a guard). Several common JS/TS bugs
   need a small rewrite of a whole expression instead (assign a dropped result back, swap a case test, add a null
   check to a typeof test, replace a prototype-unsafe copy).
2. Locate depth. repair-v1 searches the named symbol and its direct same-file callees (one level). A fault two calls
   below the entry point (entry -> factory -> worker, or a plain helper chain) is never a site.
3. Locate focus. When the named symbol is a method defined in many files, the grep fallback stops at a file cap and
   the file the request names may never be searched.

## What it adds

### Idiom templates (IDIOM_TEMPLATES, ranked before the repair-v1 templates)

Each is a pure syntactic rewrite of one expression; each needs every condition below, else nothing is proposed.

- `discarded-result`: an expression statement `R.m(args)` whose result is thrown away, where m is a non-mutating
  method that returns a new value (PURE_METHODS: filter, map, concat, slice, flat, flatMap, toSorted, toReversed,
  toSpliced, with, trim, trimStart, trimEnd, replace, replaceAll, toLowerCase, toUpperCase, padStart, padEnd,
  substring, normalize). Conditions: the call is the whole statement (dr-statement); m is in PURE_METHODS
  (dr-method); no optional chaining (dr-optional); R is an identifier or a plain property chain, not `this` itself,
  not a call or element access (dr-ref); R is not a const or import binding (dr-const). Edit: `R = R.m(args)`.
- `case-predicate`: `X.toUpperCase() === X` (or `X === X.toUpperCase()`, and the lower-case and `!==` mirrors).
  Conditions: strict equality only (cp-op); the case call has no arguments (cp-noargs); X is a plain reference
  (cp-ref); both sides are the same reference text (cp-same). Edit: `X.toUpperCase() === X` becomes
  `X !== X.toLowerCase()` (a char is upper case only if lower-casing changes it), and the mirrors likewise.
- `typeof-null`: `X && typeof X !== "object"` (either order, `!==` or `!=`). Conditions: the operator is `&&`
  (tn-and); X is a plain reference (tn-ref); the typeof compares with "object" by inequality (tn-object); both
  operands name the same X (tn-same). Edit: `(X === null || typeof X !== "object")` (falsy primitives are
  primitives; null is still treated as a primitive).
- `proto-safe-copy`: `Object.assign({}, a, ...)`. Conditions: the callee is exactly `Object.assign` (pc-object);
  the target is an empty object literal (pc-empty); at least one source (pc-sources); no spread source (pc-spread).
  Edit: `({ ...a, ... })` (a parsed `__proto__` key becomes an own data property instead of setting the prototype).

### Callee depth 2 (CALLEE_DEPTH.v2)

After each tier-1 callee, its own same-file top-level callees become tier-2 sites (same MAX_CALLEES cap, no repeats,
never the named symbol itself). Depth stops at 2. repair-v1 keeps depth 1 (depth-v1).

### File-name focus

When the request names a file by its stem (a lower-cased word of 3+ letters equal to the file name without its
extension, e.g. "the text schema" -> src/text.ts), the files searched for the named symbol are narrowed to those
files before the file cap applies (focus-named). A request naming no file keeps every file in order. repair-v2 only
(focus-v2-only). This rule was derived from the dev diagnosis (a method defined in many files); its tests use only
synthetic fixtures.

## Guards

Every repair-v2 guard is one line in editpropose.ts tagged `// m168-guard:<id>` (a separate tag, so M152's
`// guard:` list is unchanged): focus-named, focus-v2-only, depth-v1, idioms-v2-only, dr-statement, dr-method,
dr-optional, dr-ref, dr-const, cp-op, cp-noargs, cp-ref, cp-same, tn-and, tn-ref, tn-object, tn-same, pc-object,
pc-empty, pc-sources, pc-spread. test/m168-mutation.test.ts deletes each line in turn and requires an M168 case to
fail with an assertion (not a crash).

## Tests (test/m168-cases.ts, m168-repair-v2.test.ts, m168-mutation.test.ts)

- Admit: two different synthetic code shapes per idiom, per depth-2 shape and per focus shape (class methods on
  `this` fields, plain functions with let bindings, char classifiers, serializers, recursive walks, defaults merges,
  option builders, factory chains, helper chains, schema classes, driver classes in a subdirectory). None is modeled
  on a dev task's code and none is PeaceSTOCKS-shaped. Each runs the proposer against an in-process oracle.
- Refused near miss: one or more per guard (checked on the idiom output or on locate directly).
- v1 unchanged: repair-v1's template list and default name, no idiom candidate in repair-v1's candidate list, depth 1,
  no focus.
- Real loop: a synthetic node:test repo in the stage-2 isolation; repair-v2 passes (row proposer repair-v2),
  repair-v1 on the same task does not (near miss).

## Soundness note

An idiom edit is only a proposal: like every repair-v1 candidate it must parse, change the file, and pass the task's
own tests in the isolated loop; nothing here judges a fix, and no LM score is used. The guards keep each rewrite
behavior-preserving except at the one fault it targets: `discarded-result` only adds an assignment to a mutable
binding of a value the code already computed; `case-predicate` only differs from the original on characters with no
case (where the original answer is the suspected bug); `typeof-null` only differs on falsy primitives;
`proto-safe-copy` only differs on a source with an own `__proto__` key (and on setters on the target, which an empty
literal has none of). The new locate rules only add sites (depth) or reorder/narrow files the request itself names
(focus); a wrong site costs attempts, never correctness. Every rule is opt-in, so repair-v1, model-v1 and their rows
are unaffected.

## Limits

- `case-predicate` is a per-character rule; on a multi-character string `X !== X.toLowerCase()` means "has an upper
  case letter", not "is all upper case".
- No new code: regex rewrites, new functions, new imports and new features are still out of reach.
- Test runners: tasks the loop refuses before tests (TEST_RUNNER_UNSUPPORTED, DEPS_PM_CONFIG) are not helped.
- Focus matches whole file stems only; depth stops at 2.

## Dev numbers (descriptive only; no gain is claimed)

One local run, 2026-11-02 (plan-only-v4 planner, --max 20, candidate user peaceai-cand2, workspace commit of this
batch); the 12 repair-v2 rows are appended to plan/loop-runs.jsonl. Before = the latest repair-v1 rows already in
that log (plan-only-v3, --max 20).

| task | repair-v1 (before) | repair-v2 (this run) |
| --- | --- | --- |
| unjs/defu | NO_EDIT | PASS, 1 attempt |
| unjs/destr | ATTEMPT_LIMIT | ATTEMPT_LIMIT |
| unjs/scule | ATTEMPT_LIMIT | ATTEMPT_LIMIT (attempt 1 is the reference source edit; the team's added test is not written by PeaceAI, so it counts as filled by the team) |
| unjs/ohash | DEPS_PM_CONFIG | DEPS_PM_CONFIG |
| jquense/yup | NO_EDIT | PASS, 1 attempt |
| kysely-org/kysely (2) | TEST_RUNNER_UNSUPPORTED | TEST_RUNNER_UNSUPPORTED |
| ianstormtaylor/superstruct | TEST_RUNNER_UNSUPPORTED | TEST_RUNNER_UNSUPPORTED |
| open-circle/valibot | DEPS_PM_CONFIG | DEPS_PM_CONFIG |
| sindresorhus/p-queue | TEST_RUNNER_UNSUPPORTED | TEST_RUNNER_UNSUPPORTED |
| remeda/remeda | NO_MORE_EDITS | NO_MORE_EDITS |
| supermacro/neverthrow | NO_MORE_EDITS | NO_MORE_EDITS |

These describe one run on the split the rules were diagnosed on; they are not held-out evidence and not a score.
