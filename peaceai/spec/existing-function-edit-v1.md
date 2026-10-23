# EXISTING_FUNCTION_EDIT v1 (`public-existing-function-edit-v1`, kind `EXISTING_EDIT`, M98)

Two skills in one family, because neither one can be graded without the other:

- **G1, edit inside an existing function.** Replace ONE statement in an existing named function or class method.
- **G2, fake-driven test.** Write ONE new test that drives the edited code through injected, recorded fakes. Job B
  needs this test to fail before the edit (assertions only) and pass after it.

A G1 edit in I/O-facing code (storage clients, HTTP clients, schedulers) can only be graded by a test that controls
every collaborator, which is what G2 does. G2 lives in its own section of the engine
(`parseFakeTest` / `emitFakeTest` / `FAKE_HARNESS`), so a standalone characterization spec can reuse it later. That
spec would need a different grading mode (fix-free), so it is out of scope for v1.

## Credit: G1 is a splice, not a PeaceAI-authored skill (Auditor #489, hole 4)

**Status: do not approve as a skill. This rule is not in `approved.json`, and no proposal will be filed.**

In G1 the task text carries `replace statement OLD with NEW`, and NEW is the full replacement code. PeaceAI checks
NEW against a grammar, splices it in, and grades it. It writes none of the code it would be credited with. The same
is true of the S1-S3 evidence and the fix B / fix C dry runs.

Auditor's fix: the issue states only the behavior change ("measureStorage should count `head()` sizes"), and PeaceAI
derives the edit. That is program synthesis / automated repair: choosing the statement and generating code that
makes a test pass. Today PeaceAI applies rules deterministically (parse a trigger, apply a bounded transform, grade).
It has no candidate search over code, so it cannot derive a statement from a behavior description. As Peace
instructed, that part stopped here, and it is reported as a **skill gap**. The splice design is not kept as a skill.

What stays on this branch, and why:

- The engine hardening for holes 1-3, the helper/fixture exclusion and the confined new-test run. These protect
  any future `EXISTING_EDIT`-style kind and cost nothing while this rule is unapproved.
- G2 (the fake-driven test grammar). Its credit model matches the already-approved `public-test-case-existing-*`
  family: PeaceAI turns the stated expectations into a test. In v1, G2 can't land alone, because Job B pairs it
  with a G1 edit.

A possible next design (needs Peace's decision): derive edits from a small set of named edit templates, each a
separate rule, with triggers that name only the behavior. Two examples:

- Call substitution guided by the interface, such as `get` to `head` on the same receiver when the interface types
  it.
- Wrapping an awaited call in a bounded retry.

PeaceAI would build candidates from a template and keep only those the G2 test grades as fail-before / pass-after.

## Task phrasing

```
in Class.method in src/file.ts: replace statement OLD with NEW
- fake NAME = { m: resolves(V), n: rejects("MSG"), k: sequence(resolves(V), rejects("MSG")), data: V }
- fake NAME = returns(V)
- expect new Class(ARGS).method(ARGS) resolves to V
- expect fn(ARGS) returns V | rejects with "MSG" | throws "MSG"
- expect NAME.m is called N times
```

`Class.method` can also be a bare `functionName`.

### Values

V can be any of:

- a literal
- an array or an object
- `bytes("text")`, which becomes `TextEncoder` bytes
- `date("ISO-Z")`, a UTC instant only
- `response(STATUS[, "body"[, { header: "v" }]])`, with STATUS from 200 to 599
- the name of a fake declared earlier

Limits:

- strings up to 400 characters
- arrays up to 50 items
- at most 16 bullets
- any string that names a reflection key (`constructor`, `__proto__`, `prototype`, ...) is refused

## G1: the site

### The target

- a module-level function declaration with a body and no overloads, or
- a non-static, non-abstract method with a body of a top-level class

The file must be in `src/**.ts`. It cannot be a test file, a `.d.ts` file or a `PROTECTED_SELF` path.

### OLD

- one variable, expression, return, throw or if statement
- matched token for token (trivia and a trailing `;` are ignored)
- exactly once among the target's **own** statements: the walk descends into blocks, if/else, loops, try, switch and
  labels, but never into nested functions or classes

### NEW (`bounded-grammar-v1`)

1 to 4 statements, built from:

- `const` / `let` declarations
- expression statements
- if/else, return, throw, blocks
- try/catch/finally
- `for (const x of [literal list of up to 8 items])` and `for (const x of name)`
- break / continue inside a loop

Refused in NEW:

- template literals, `delete`, `arguments`, `yield`, `import.meta`
- function and class declarations and class expressions
- while, do, `for (;;)`, for-in, switch and labels
- `await` when the target is not async

Every name that OLD declares must still be declared at NEW's top level. A non-list parent (an unbraced `if` or loop
body) gets `{ }`. The whole module must still parse after the edit.

### Splitting OLD from NEW

The text is split at ` with `, and exactly one split point may give two parseable sides.

Comments are found with the TypeScript scanner, so a string like `"https://x"` does not count as one. A comment
refuses the split.

## G2: the test

The emitted file is `<stem>.<slug>-<id7>.test.ts`:

- id7 is the sha256 of the trigger line plus the bullets
- the path must not already exist in the full checkout

It imports only `node:assert/strict`, `node:test` and the named exports of the module. It holds:

- the fixed harness: `fakeFn` records calls, and the last outcome repeats; `settle` / `settleSync` capture outcomes,
  so the base fails by an assertion, not by a crash
- one test: the fake declarations, then `assert.deepEqual(await settle(() => CALL), { ok: true, value: V })` or
  `{ ok: false, message }`, then `assert.equal(X.k.calls.length, N)`

## The hermetic walk (`io: injected-only-v1`)

It runs on the module's whole relative-import closure, on the base source and on the edited source alike. The entry
must be exported.

### Load time

Variable, enum, export-default and static-field initializers are walked.

- Function bodies are skipped. Only the module functions that load-time code actually calls are walked.
- Package value imports are refused (`edit_package_import`).
- Builtin imports are refused (`edit_io_import`), except `node:crypto` `createHash` / `createHmac`.

### Reach from each CALL

The walk starts from the class's field initializers and constructor plus the called method, or from the exported
function. It follows `this.m`, module functions, the closure's exports and arrows that get called.

Globals:

- Only a fixed allow-list may be read: Math, JSON, Number, String, Array, Object, the Error types, typed arrays,
  Map/Set/Promise, URL, TextEncoder/TextDecoder, Headers/Response/Request, the URI functions, parseInt/parseFloat and
  console.
- Even on the allow-list, these members are refused: `Math.random`, `Object.defineProperty`/`assign`/
  `setPrototypeOf`, `Promise.race`, `Buffer.allocUnsafe`, ...
- Everything else is `edit_io_global`. That covers `Date`, `process`, `fetch`, timers, `globalThis`, `Intl`,
  `Reflect`, `Symbol`, `AbortController`, ...

Refused patterns:

| Pattern | Code |
| --- | --- |
| A local-time read or Date setter, on any receiver | `edit_local_time` |
| A write to a global, a module binding or an import | `edit_global_write` |
| Module `let` / `var`, or module data used other than read-only | `edit_hidden_state` |
| `extends` / `super` | `edit_class_extends` |
| A computed call `x[k]()` | `edit_computed_call` |
| A write to an entry parameter | refused |

**Capability defaults.** `config.fetchImpl ?? fetch`, `config.now ?? (() => new Date())`, and a parameter default
are skipped **only** when the test injects that key or argument. Otherwise the default is walked like any other code,
so an un-injected `fetch` / `Date` is refused.

**Reaching the target.** The edited function or method must be reached by at least one CALL, on both sources
(`edit_test_unreached`).

## Job B (`gradeExistingEdit` in `peaceai/bin/test-candidates.ts`)

Job B only runs for `LEARNED_EXISTING_EDIT` candidates, and before the generic self-grade branch. Steps:

1. Check the candidate shape: exactly one edited source file plus one new test file.
2. `editConfinedTarget`: exactly one function or method differs from the task base, and every other top-level unit
   is byte-identical.
3. `gradedTestCalls`: the test must be exactly the emitted header, the harness and the bullet language, re-parsed
   into the same call shapes. Anything else is `edit_test_shape`.
4. Run the hermetic walk again on the base and on the real tree.
5. Run the after-tree confined under the Node permission model (reads: the test, the module closure, node_modules)
   in every pair of `EXISTING_EDIT_ENV_RUNS`: UTC / C.UTF-8, America/Denver / tr_TR.UTF-8, Asia/Tokyo / ja_JP.UTF-8.
   This is the backstop for locale-dependent built-ins such as `localeCompare`.
6. Put the module back to the base. The same confined run must FAIL, and every failure must be `ERR_ASSERTION`.

There is no M7 repair. The scope, leak and core-text gates are the same as for every candidate.

## Paths

There is no per-repo path allow-list (`paths: in-scope-source`). Safety comes from three places:

- the scope gate
- `PROTECTED_SELF`
- the hermetic walk on both sources

The walk refuses every way the edit or its test could reach I/O, the clock, the environment, hidden state or a
package. Job B re-derives all of it from the graded tree, never from the task text.

## Capability delta (Auditor #489)

Job A and Job B both compare the target unit on the base with the edited unit. If the edit introduces any
capability token the base unit lacked, the result is `edit_new_capability`:

- an `as any` / `as unknown` cast
- a reflection-name member (`constructor`, `__proto__`, `prototype`, ...)
- a reference to `fetch`, `process`, `require`, `globalThis`, `eval`, `Function`, `Reflect`, `Proxy`, timers, or a
  module global
- a dynamic computed member access `x[k]`, unless both `x`'s root and `k` are the target's own parameters
  (string-built keys like `["__pro", "to__"].join("")` on a local or parameter receiver are refused)

Tokens are counted, not just checked for presence, so an edit can't add a second `?? fetch` beside one the base had.

This refuses the following, however the name is spelled or built:

- the `Function` constructor reached through a cast
- `__proto__` pollution through `({} as any)[k]`
- a new real-I/O default hidden behind `??`

A pre-existing `?? fetch` default in unchanged code still passes when the test injects that key. The public run-log
reason is just `edit_new_capability`, so it never says which capability tripped.

Hardening in the walk itself:

- Computed member access is allowed only when the receiver's root is an identifier or `this`. Writes through any
  other root are refused (`edit_global_write`).
- `*.test-helper.ts` files and the `fixtures/`, `__fixtures__/`, `__mocks__/`, `__tests__/`, `testdata/`,
  `test-helpers/` and `mocks/` directories are never edit targets or closure files. This holds whatever
  `denyPatterns` says.
- The emitted test runs only under the Node permission model: in Job B, and in the new-test pass of
  `test-candidates.ts`. It is never run unconfined.

## Known residual risk

A computed read `x[k]` is allowed when the receiver is an identifier or `this`, and the key may come from the test.
The mitigations:

- Test strings equal to reflection names are refused.
- Literal keys are checked against the reflection list.
- Computed calls are refused.
- Any new cast, and any new dynamic computed key that isn't `param[param]`, is refused by the capability delta.

## Evidence

Bar: 10 per skill. The full list is in `peaceai/rules/proposals/m98-existing-function-edit-evidence.json`, with the
fixtures in `peaceai/test/fixtures/m98-ee/`.

- **G1:** 15 upstream commits from 15 permissive repos. `editStatement` on the parent text reproduces the child's
  code tokens exactly.
- **G2:** 15 upstream tests from 15 permissive repos that drive a method or function with injected object-literal
  fakes. The hermetic walk accepts the same call shape on the pinned closure.
