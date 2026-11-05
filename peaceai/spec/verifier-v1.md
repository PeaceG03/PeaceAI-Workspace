# VERIFIER-V1 (M202, batch 38): experimental out-of-process verification

Status: EXPERIMENTAL, NOT DEFAULT, NOT FOR CREDIT. Code: `peaceai/lib/verifier.ts`, harness
`peaceai/lib/verifier-harness.cjs`, judge `peaceai/lib/verifier-judge.cjs` (M204), CLI `peaceai/bin/verifier-v1.ts`,
tests `peaceai/test/m202-verifier.test.ts`, `peaceai/test/m204-verifier-cases.test.ts`,
`peaceai/test/m205-verifier-forms.test.ts`, `peaceai/test/m206-verifier-forms.test.ts`. Batch 40 (M204) /
Batch 41 (M205) / Batch 42 (M206) changes are in the sections below; where they and the M202 text differ, the later
section wins.
Loop opt-in: `LoopOptions.verdictMode = "oop-v1"` (or `selectVerdictMode("oop-v1")`). Default remains `inproc`.
`EDIT_SCOPE_POLICY`, `selfpropose.ts`, `plandefault.ts` and the v4 digest are unchanged.

## Why

M199–M201 found every in-process runner (vitest, jest, node:test, mocha) unsound under an edit scope wider than the
M175 bound: the verdict shares a heap / process with the code under test. `peaceai/spec/loop-runners-inproc-m201.md`
recorded the sound design. This batch builds that design as a reusable library and proves it on the attack families.

## Design

1. **Two processes, two uids.** The candidate process (`PEACEAI_STAGE2_CAND`, never the verifier) loads the candidate
   module through a fixed harness and answers call requests (function name + JSON args) with JSON results / errors over
   stdin / stdout only. The verifier process (the box / runner uid) holds the test cases as data and compares with its
   own primordials (`Object.is` and friends captured at load). It never imports candidate code.
   (M204: three uids. The comparison now runs in `verifier-judge.cjs` as a third uid, `PEACEAI_VERIFIER_UID`; the
   runner only relays. See "M204: third uid".)
2. **Harness.** `verifier-harness.cjs`, started as `node --disable-sigusr1 harness.cjs <module>` under
   `sudo -n -u <cand> -- env -i PATH=... HOME=<priv> TMPDIR=<priv> NODE_OPTIONS= setsid --wait`. No `--inspect`, no
   extra fds, env scrubbed. One JSON object per line, version 1.
3. **Defensive deserialize.** Size limit (`MAX_LINE_BYTES`), depth limit (`MAX_DEPTH`), per-call and session timeouts.
   Any protocol deviation, oversize payload, unexpected id, or non-protocol stdout is a fixed refusal
   (`OOP_PROTOCOL`, `OOP_OVERSIZE`, `OOP_DEPTH`, `OOP_TIMEOUT`, `OOP_STDOUT_NOISE`).
4. **Case source (conservative; superseded by the M204 fail-closed extractor below).** A JSON case file (`version: "verifier-v1"`), or extraction from only
   `assert.strictEqual(fn(lit...), lit)` / `assert.equal` / `assert.deepStrictEqual` / `expect(fn(lit...)).toBe(lit)` /
   `.toEqual(lit)` with literal args. Anything else that looks like an assertion is `OOP_CASES_NONLITERAL`. Empty is
   `OOP_CASES_EMPTY`. Does not claim coverage of arbitrary tests.
5. **Loop wiring.** `inprocScopeProblem(runner, classes, verdictMode)` returns null when `verdictMode === "oop-v1"`
   (`m202-guard:oop-skip`), so TERMINAL does not apply to verdicts produced by verifier-v1. Under `oop-v1` the loop
   judges team tests through `runTestsOop` (extract + verify). If cases cannot be derived: `VERDICT_OOP_CASES`. Other
   verifier refusals: `VERDICT_OOP_REFUSED`. Default mode is unchanged: the M199 gate and every in-process runner path
   behave as before.

## Attack table (candidate source; honest cases expect the right leap / value)

| id | attack (in candidate `isLeap` / `toCelsius`) | in-process (M199–M201 / re-check) | verifier-v1 |
|---|---|---|---|
| H-Object.is | `Object.is = () => true` | CREDITED (naive / vitest / jest) | FAIL (value) |
| H-proto | `Object.prototype` setter for a matcher field | CREDITED (mocha H1; vitest/jest variants) | FAIL / no effect on verifier |
| H-expect | `expect.extend({ toBe: () => ({ pass: true }) })` | CREDITED (vitest / jest) | FAIL (verifier never calls expect) |
| H-assert | patch `assert.strictEqual` | CREDITED when assert is in-process | FAIL |
| X-exit | `process.exit(0)` / `reallyExit(0)` | refused or EXIT_ONLY (shim); mocha channel variants CREDITED | REFUSED (`OOP_PROTOCOL`) or case fail |
| X-stdout | forge `# pass` / a protocol line on stdout | often refused by shim; channel forge on fd 3 CREDITED on mocha | REFUSED (`OOP_STDOUT_NOISE`) |
| X-fs | `process.binding("fs").writeString` on a report fd | CREDITED on mocha M193 route (M201 A1) | no shared report fd; FAIL / PROTOCOL |
| X-inspector | `node:inspector` Session reads a nonce / closures | CREDITED on mocha (M201 A2–A4) | inspector off (`--disable-sigusr1`); FAIL / PROTOCOL |
| X-worker | worker + SharedArrayBuffer / connectToMainThread | CREDITED on mocha (M201 A5) | FAIL / PROTOCOL (no channel to verifier) |
| X-child | child + SIGUSR1 + forge | CREDITED on mocha (M201 A6) | SIGUSR1 disabled; FAIL / PROTOCOL |
| X-procmem | scan `/proc/self/mem` for a nonce | nonce reachable on mocha launch (M201 A7) | no verifier nonce in candidate; N/A / FAIL |
| R-proto-dev | non-JSON stdout, wrong id, oversize, deep JSON | — | REFUSED (per guard) |
| R-nonlit | `assert.strictEqual(fn(x), y)` with non-literal `x` | — | `OOP_CASES_NONLITERAL` |

Honest shapes (credited under verifier-v1 when the module is correct; fail when buggy): leap years, temperature
conversion (F to C). Neither is from PeaceSTOCKS, a dev task, or a reference diff.

## Guards (each tag is one line; m202-verifier deletes each in a mutant and requires its own case to fail)

- `m202-guard:oop-skip` — `inprocScopeProblem` returns null under `oop-v1`.
- `m202-guard:default-inproc` — `selectVerdictMode(undefined)` is `inproc`.
- `m202-guard:oversize` / `depth` / `proto-*` / `noise` / `nonliteral` / `empty` / `cand` / `module` / `ok` — see
  `verifier.ts`.
- `m202-guard:loop-oop` / `loop-cases` / `loop-refused` / `mode-select` — loop wiring.

## Residuals (honest)

- **Same kernel.** Candidate and verifier share a kernel. A kernel bug is out of scope.
- **No seccomp.** The candidate is not under a syscall filter; it can still open files it can reach, spawn processes as
  its own uid, and burn CPU until the deadline. It cannot write the verifier's verdict.
- **Yama ptrace.** The box has no `/proc/sys/kernel/yama/ptrace_scope` (Yama off / absent). Classic uid checks still
  apply: as of this batch, `peaceai-cand3` **cannot** `PTRACE_ATTACH` the verifier (box) uid (`EPERM`), cannot
  `process_vm_readv` it, cannot send it `SIGUSR1`, and cannot read `/proc/<box-pid>/mem`. Residual: if the verifier
  were ever run as the same uid as the candidate, or if a future kernel / capability change granted the candidate
  `CAP_SYS_PTRACE`, this would need re-proof. Prefer `ptrace_scope >= 1` on hosts that run verifier-v1 for real.
- **JSON values only.** A candidate that returns the right answer on purpose is an honest pass (the design's point).
- **Not a general test runner.** Only data-only cases. Mocha / vitest / jest / node:test stay `INPROC_VERDICT_TERMINAL`
  under a wider in-process scope; oop-v1 is a separate opt-in path.
- **Per-case process.** v1 starts one candidate process per case (simpler sync control). A future revision may keep a
  session process; the protocol and uid split stay.

## M204 (batch 40): fail-closed extractor, exact values, third-uid judge

### Soundness note

The claim is narrow: **when verifier-v1 credits a file, every assertion in it was extracted as a case, each case means
exactly what the assertion means on a JSON value, and each case held.** Anything the extractor cannot reproduce
exactly is refused by name; nothing is skipped.

- **Fail-closed extraction.** `extractCasesWithStats(source)` returns `{ result, stats }` with
  `stats = { tests, assertionsSeen, supported, extracted, refusals }`. A file is admitted only if every test has at
  least one assertion and every assertion became a case (`extracted === assertionsSeen`; untagged backstop
  `OOP_CASES_UNSUPPORTED_TEST:uncounted`). On refusal `extracted` is 0. Refusal details are fixed words / matcher
  names (sanitised), never message text from the file.
- **Refusal codes.** `OOP_CASES_UNSUPPORTED_ASSERT:<matcher>` (an assertion form we do not reproduce),
  `OOP_CASES_UNSUPPORTED_TEST:<form>` (test modifiers `skip/only/each/todo/concurrent`, hooks, `t`/`done` params,
  non-assertion statements in a test or suite, top-level code other than imports / `require` / literal consts / types /
  `"use strict"` / test and describe calls, imports from other libraries or a second relative module),
  `OOP_CASES_NO_ASSERT` (a test with zero assertions), `OOP_CASES_NONLITERAL` (non-literal argument or expectation),
  `OOP_CASES_EMPTY`. A mixed test (one supported + one unsupported assertion) refuses the whole file.
- **Silent-skip regression.** The Batch 39 extractor (550357a) admitted a file whose other assertions it did not
  recognise and judged the subset. m204 reproduces that shape with the old extractor (admits, cases dropped) and
  requires the new one to refuse. Dev census: the old extractor admitted unjs/destr with 1 case out of 26 assertions;
  the new one refuses it.

### Admitted forms (JSON-exact only)

| source form | case | judge rule |
|---|---|---|
| `assert.strictEqual(f(lit..), prim)` (strict assert: `node:assert/strict`, `assert/strict`, or `{ strict as X }`) | value, cmp is | exact && Object.is |
| `assert.deepStrictEqual(f(..), lit)` | value, cmp deep | exact && valuesEqual |
| `assert.notStrictEqual(f(..), prim)` | negate | !(exact && Object.is) |
| `assert.throws(() => f(..))`, `(.., BuiltinError)`, `(.., { name?: str, message?: str or /re/ })` | throws | where=call; isa / name / message (not truncated) |
| `assert.doesNotThrow(() => f(..))` | any | synchronous return |
| `expect(f(..)).toBe(prim)` / `.not.toBe(prim)` | value is / negate | as above |
| `expect(f(..)).toEqual(lit)` / `.toStrictEqual(lit)` | value deep | exact && valuesEqual |
| `expect(() => f(..)).toThrow()` / `(BuiltinError)` / `("text")` / `(/re/)` (and `toThrowError`) | throws | isa / includes / regexp |
| `expect(() => f(..)).not.toThrow()` | any | synchronous return |

Sources: `node:test`, `vitest`, `@jest/globals`, `mocha` (test fns); `vitest` / `@jest/globals` / `expect` (expect);
ESM import or CJS `require`, named / aliased / namespace target bindings (namespace calls get `recv: "module"`).
Every ok-form case also needs a **synchronous** result (a Promise / thenable return is `async`, never credited).

Refused near misses (each in m204's NEAR table): legacy `assert.equal` / `deepEqual` (loose), `strictEqual` /
`toBe` / `not.toBe` / `notStrictEqual` with an object expectation, `throws` with a string / regexp / validator / other
keys, `toThrow` with a non-literal, user class or object, `toContain`, `toMatchObject`, `toBeNull`, `toBeCloseTo`,
`toHaveLength`, `toMatchInlineSnapshot`, `toBeInstanceOf`, `resolves.*` / `rejects.*`, `assert.ok` / `assert()` /
`match` / `rejects`, async thunks, `-0` / `__proto__` literals, non-target calls, and the test-form refusals above.

### Exactness (harness, candidate side)

`replyValue` marks a result `exact` only if it is plain JSON data: finite numbers other than -0, strings, booleans,
null, arrays with Array.prototype and no holes / extra keys, objects with Object.prototype and only enumerable string
data properties, depth <= 32. NaN, Infinity, -0, undefined, functions, symbols, bigint, class instances, null-proto
objects, accessors, holes, Map / Set / Date are inexact and never credited by a value / negate case (`toEqual`
treating them as equal is a *false fail*, not a false credit). Thrown values report `obj` / `isa` / name / message;
a thrown non-object or a message over 2000 chars (`trunc`) is not credited for name / message / includes.
Failures report `where` in `load | lookup | call | await | proto`; only `call` credits a throws case.

### M204: third uid

Three uids, one job each:

1. **Candidate** (`PEACEAI_STAGE2_CAND`, here `peaceai-cand3`): runs the harness, one process per case.
2. **Runner** (the box uid): extracts cases, spawns the candidate, relays each raw `{status, stdout, timeout}`. It
   does not judge.
3. **Verifier** (`PEACEAI_VERIFIER_UID`, here `peaceai-verify`): runs `verifier-judge.cjs` via `sudo -n -u`, which
   parses the raw runs with its own primordials, writes `verdict.json` (`wx`, 0644) into a verdict dir created
   `install -d -o <verifier> -m 0755`. The runner accepts the verdict only if the file is owned by the verifier uid
   and not group / other writable (`m204-guard:verdict-owner`), else `OOP_JUDGE`.

Fail-closed uid checks (`verifierUid`): unset `OOP_VERIFIER_REQUIRED`; bad name / missing user / unreachable via
`sudo -n -u` / verifier has sudo itself `OOP_VERIFIER_BAD`; root, the runner uid, or the candidate uid
`OOP_VERIFIER_NOT_SEPARATE`. Before any run, `verify` refuses `OOP_VERIFIER_BAD cand-writable:<what>` if the
candidate uid can write (owner / other bit / group bit with membership; `m204-guard:perm-*`) the work dir, the
harness / judge copies, their sources, lib, the spec, or the verdict dir; the verdict dir must be owned by the
verifier. m204 tests each: cand3 write attempts on each path fail (EACCES), and each misconfigured uid is refused.

`peaceai-cand` (uid 997) cannot be the verifier: it is the CI candidate uid, so it would equal the candidate.
**Privileged setup (once per host, done on this box in batch 40):** `useradd --system --no-create-home --shell
/usr/sbin/nologin peaceai-verify` (no sudo rights for it). The runner must be able to `sudo -n -u peaceai-verify`
and `sudo -n install -d -o peaceai-verify` (on this box the runner's existing passwordless sudo covers both; on CI a
sudoers entry is needed). CI / other hosts need the same step; without it
oop-v1 refuses `OOP_VERIFIER_REQUIRED` / `OOP_VERIFIER_BAD`. m202 / m203 / m204 e2e tests now need
`PEACEAI_VERIFIER_UID` set.

### loopSha256

`loopSha256` now hashes `lib/repair-retry.ts` (`m204-guard:sha-repair-retry`) and `lib/verifier.ts`,
`lib/verifier-harness.cjs`, `lib/verifier-judge.cjs` (`m204-guard:sha-verifier`). A missing file hashes as a fixed
absent marker (partial copies in m152 / m167 keep working). loopSha256 is not pinned anywhere (only relative-change
tests), so no Auditor-reviewed digest changes. The v4 digest, `selfpropose.ts`, `plandefault.ts`, `plan4.ts` are
byte-identical.

### Guards (m204-guard; m204 deletes each line in a mutant and runs that guard's own case)

Extractor: `lit-neg-zero`, `lit-proto`, `test-modifier`, `hook`, `test-shape`, `test-params`, `top-level`,
`target-binding`, `thunk-async`, `loose-equal`, `is-object`, `throws-arg`, `tobe-object`, `tothrow-arg`,
`unsupported-matcher`, `test-stmt`, `no-assert`, `multi-module`. Harness: `h-number`, `h-array-proto`,
`h-object-proto`, `h-symbol`, `h-data-prop`, `h-trunc`, `h-async`. Judge: `sync`, `negate-primitive`, `exact`,
`cmp-is`, `where-call`, `isa`, `err-name`, `err-msg-str`. Uid / perms: `verifier-required`, `verifier-root`,
`verifier-vs-runner`, `verifier-vs-cand`, `perm-owner`, `perm-other`, `perm-group`, `perm-check`, `verdict-owner`.
Loop: `sha-repair-retry`, `sha-verifier`. The m202 mutation test now also scans `verifier-judge.cjs` (its m202 tags
moved there).

### Dev census (informational; 12 public dev tasks, team test files at the merge commit; no tuning)

All 13 files refuse (0 admitted, 0 cases). First refusal per file: `UNSUPPORTED_TEST:import-other` 4,
`UNSUPPORTED_TEST:stmt:var` 2, `UNSUPPORTED_TEST:suite-stmt:*` 3, `UNSUPPORTED_TEST:test-modifier:each` 1,
`UNSUPPORTED_TEST:top-level:var` 1, `NONLITERAL:expect-nonliteral` 2. Assertions seen 380, supported-form 11,
extracted 0. Batch 39 extractor on the same files: 1 admitted (unjs/destr, 1 case of 26 assertions: a silent skip),
12 refused (7 EMPTY, 5 NONLITERAL). So oop-v1 still covers none of the dev split; that is the price of no silent skip.

### M204 residuals (honest)

- **Forged stdout (pre-existing).** The candidate owns its stdout and can print any reply line, including an `exact`
  value it never computed. That is an honest pass only if the value is right; the judge compares to the expectation.
  `isa` / `where` / `sync` flags are candidate-reported too, so a hostile candidate can claim them.
- **ACLs** are not checked by `candMayWrite` (owner / mode bits only). The box uses none on these paths.
- **`has-sudo` check untested:** no third sudo-capable user exists on the box to exercise it.
- **`recv: "module"` `this`** is a spread copy of the namespace, not the live module namespace.
- **Conservative fails:** toEqual requires exactness; thrown non-objects and truncated messages are not credited.
- **Unreachable backstops:** the `uncounted` seen != extracted check and the other-assert fallthrough are untagged
  (deleting either is unobservable by construction).

## M205 (batch 41): more general admitted test shapes (still fail-closed)

### Soundness note

The M204 claim still holds: **when verifier-v1 credits a file, every assertion in it was extracted as a case, each case
means exactly what the assertion means on a JSON value, and each case held.** M205 only adds shapes the extractor can
reproduce *exactly* by static inspection. Anything not exactly reproducible stays refused by name. The extractor never
evaluates test code (no `eval`, no running the file, no executing callbacks).

New forms, each with two or more admitted shapes unrelated to PeaceSTOCKS / the public-dev tasks / reference diffs, a
refused near miss for every condition, and tagged guards whose mutants are caught by a case of that guard:

| form | what is admitted | refused near misses |
|---|---|---|
| **describe / suite nesting** | Pure grouping. Nested `describe` / `suite` with string titles and zero-param callbacks. Suite names concatenate into case ids (`outer/inner/cN:fn`). | `describe.each`, suite callbacks with params, generators |
| **const-of-JSON-literal** | `const name = <JSON lit>` at top level, in a suite, or in a test body. Identifiers (and `obj.prop` of a bound object) resolve to that value in arguments / expectations. | `let`/`var`, shadowing, reassignment (`=`, `+=`, `++`), non-literal initializers, destructuring |
| **test.each / it.each** | `test.each(<array lit>)(<string>, (params) => ...)` where the table is an array of equal-length arrays of JSON lits, an array of JSON primitives, or an array of plain JSON objects (one object param or a simple object-binding pattern). One case per row; params bind as consts. | non-literal table (including a const binding of the table), tagged-template `each`, `test.skip.each` / `only.each`, arity mismatch, empty table, param shadowing an outer const, `describe.each` |
| **unused imports** | A non-lib / second relative import that no extracted case uses is ignored. The module under test is the single relative module that appears in extracted calls. | a *used* package import, two *used* relative modules (`multi-module`), side-effect imports |

`assertionsSeen` counts AST assertion calls once; `test.each` expands one AST assertion into N cases, so the fail-closed
check compares covered AST assertions (not expanded case count) to `assertionsSeen`. Mixed / unsupported assertions still
refuse the whole file with `extracted = 0`. The Batch 40 silent-skip regression still refuses.

### Guards (m205-guard; m205 deletes each line in a mutant and runs that guard's own case)

`const-resolve`, `const-prop`, `const-bind`, `const-in-test`, `const-kind`, `const-shape`, `const-shadow`,
`const-reassign`, `suite-nest`, `suite-id`, `each-table`, `each-params`, `each-shape`, `each-shadow`, `each-expand`,
`unused-import`.

### Dev census (informational; same 13 public-dev team test files; no tuning)

M204 baseline: 0 admitted / 0 extracted (380 assertions seen, 11 supported-form). M205 re-run (no tuning): still 0
admitted / 0 extracted (380 seen, 11 supported). First refusals moved off `import-other` for several files (unused
imports now ignored) onto later blockers (`stmt:var`, unequal-length `test.each` tables, `toMatchObject`, suite
loops). The exact forms above do not yet cover these team files; that is expected and not a target.

### M205 residuals (honest)

- **Const tables for each / describe.each / tagged-template each.** Addressed in M206 (with the safe-binding and
  literal-cell restrictions documented there).
- **Property access** on a const object is admitted (`row.s`); computed keys and methods are not.
- **Unused import side effects** of a named/default import are not reproduced (same class of residual as type-only
  imports already were). Side-effect-only `import "./x"` stays refused.

## M206 (batch 42): more exact-reproducible bindings and each forms (still fail-closed)

### Soundness note

The M204/M205 claim still holds: **when verifier-v1 credits a file, every assertion in it was extracted as a case, each
case means exactly what the assertion means on a JSON value, and each case held.** M206 only adds shapes the extractor
can reproduce *exactly* by static inspection. The extractor never evaluates test code. Anything not exactly reproducible
stays refused by name.

New forms, each with two or more admitted shapes unrelated to PeaceSTOCKS / the public-dev tasks / reference diffs, a
refused near miss for every condition, and tagged guards whose mutants are caught by a case of that guard:

| form | what is admitted | refused near misses |
|---|---|---|
| **let/var of JSON lit** | `let`/`var name = <JSON lit>` at top level, in a suite, or in a test body, when the name is never reassigned (`=` / compound / `++`/`--`), never mutated (property write or method call on it), and never referenced inside a nested function (capture). Resolved by value like const. | reassign, compound, `++`, method call, property write, nested capture, non-literal initializer |
| **each table identifier** | `test.each(rows)` / `it.each(rows)` where `rows` is a const (or safe let/var) bound to a JSON array lit, and the binding is never mutated. | unbound id, non-literal initializer, mutated table (`.push` etc.) |
| **describe.each / suite.each** | `describe.each(table)(title, (params) => { it/... })` and `suite.each(...)` with a literal (or safe bound) table. One suite path per row (`title/@i/...`); names concatenate. | non-literal / empty table, `describe.only.each`, arity mismatch |
| **tagged-template each** | `test.each` / `describe.each` tagged templates when the header is a plain identifier list and every cell expression is a JSON literal. Positional params or object / object-binding of header keys. | non-literal cell, non-identifier header, no `${}` cells (text-only body) |
| **destructuring const** | `const { a, b } = { a: lit, b: lit }` and `const [x, y] = [lit, lit]` (simple identifiers, non-computed, no defaults, no rest, no holes, no nesting). | defaults (even literal), rest, nested patterns, computed keys, `let`/`var` destructure |

`assertionsSeen` still counts AST assertion calls once; `test.each` / `describe.each` expand one AST assertion into N
cases, so the fail-closed check compares covered AST assertions (not expanded case count) to `assertionsSeen`. Mixed /
unsupported assertions still refuse the whole file with `extracted = 0`. The Batch 40 silent-skip regression and every
M205 admit still hold.

### Guards (m206-guard; m206 deletes each line in a mutant and runs that guard's own case)

`var-bind`, `var-reassign`, `var-mutate`, `var-capture`, `each-const-table`, `suite-each`, `suite-each-expand`,
`each-tagged`, `each-tagged-header`, `each-tagged-cell`, `const-destructure`, `const-destructure-array`,
`const-destructure-default`.

### Dev census (informational; same 13 public-dev team test files; no tuning)

M205 baseline: 0 admitted / 0 extracted (380 assertions seen, 11 supported-form). M206 re-run (no tuning): still 0
admitted / 0 extracted (380 seen, 11 supported). First refusals unchanged in aggregate
(`top-level:var` 2, `stmt:var` 3, `test-modifier:each` 1, suite/top-level other 5, `expect-nonliteral` 2). The new
forms do not yet cover these team files; that is expected and not a target.

### M206 residuals (honest)

- **Closure capture is syntactic.** A nested function that mentions a let/var is refused even when the nested function
  only reads it. Throws-thunks that close over a let/var therefore refuse; use a const for those.
- **Method-call mutation.** Any `name.method(...)` on a scoped binding is treated as mutation (including
  `toString` / `valueOf`). Reads via `name.prop` (property access without call) stay allowed.
- **ACLs / `has-sudo`** residuals from M204 unchanged.
- **Forged stdout** residual from M204 unchanged.
