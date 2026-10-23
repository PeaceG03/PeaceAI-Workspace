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
It has no candidate search over code, so it cannot derive a statement from a behavior description. Per Auditor's
direction, that part stopped here, and it is reported to Peace as a **skill gap**. The splice design is not kept as a skill.

What stays on this branch, and why:

- The engine hardening for holes 1-3, the helper/fixture exclusion and the confined new-test run. These protect
  any future `EXISTING_EDIT`-style kind and cost nothing while this rule is unapproved.
- G2 (the fake-driven test grammar). Its credit model matches the already-approved `public-test-case-existing-*`
  family: PeaceAI turns the stated expectations into a test. In v1, G2 can't land alone, because Job B pairs it
  with a G1 edit.

### Skill-gap report: deriving the edit (needs Peace's decision before any work)

**What the issue may contain under the redesign.** Only behavior: the target (`in T in FILE`) and G2 bullets
(fakes with values, expected results, call counts). No code, no expressions, no statement text. The G2 grammar is
already value-only, so this is the existing bullet language minus the `replace statement OLD with NEW` clause.

**What PeaceAI would have to do that it cannot do today.**

1. *Locate*: pick which statement of T to change. Today the issue names it (OLD).
2. *Generate*: produce candidate replacement statements. Today the issue supplies NEW verbatim.
3. *Select*: run the G2 test against each candidate and keep the one that fails before / passes after. Today Job A
   never executes code. Selection would need a confined execution step in Job A (or Job B grading N candidates),
   with the same permission model and static gate as Job B, and a budget.
4. *Disambiguate*: refuse when zero or more than one candidate survives, so PeaceAI never guesses.
5. *Type knowledge*: candidates such as "call `head` instead of `get`" need the receiver's interface type, meaning a
   TypeScript type-checker pass over the module closure. The engine is syntax-only today.

**Smallest teachable version (G1-T, one rule per template, each its own spec and evidence).** A closed list of
single-statement edit templates. PeaceAI enumerates every instance of a template over T's own statements, and the G2
test chooses among them:

- **T-swap (interface-guided call substitution):** on one `await this.X.m(args)` / `X.m(args)` call, replace method
  `m` with another method `n` of the same receiver's declared interface that takes the same arguments, and remap the
  one result property the statement reads to a property of `n`'s declared return type with the same type. This
  covers scanner fix B (`get(key)?.byteLength` to `head(key)?.size`).
- **T-retry (bounded retry wrap):** wrap the single awaited call in a returned statement in a fixed-shape loop of
  K in {2, 3} attempts that retries on a rejection or a 5xx response. K is chosen by the test's call count, not by
  the issue. This covers scanner fix C, immediate retry only (G3 backoff stays separate).

Credit under G1-T: the issue writes no code. PeaceAI chooses the statement, the template instance and its parameters,
and the test it emits checks them. Before G1-T could be approved, Auditor would need: evidence of 10 or more
upstream single-statement fixes per template replaying exactly; the uniqueness refusal; the selection step's
confinement; and a census of how many PeaceSTOCKS targets each template reaches.

**Status on this branch.** None of G1-T is built. **The splice trigger is disabled in code**, not only unapproved:
the production entry `existingEditDetail` (reached from `applyRule` and `applyExistingEditRule`) refuses every task
with `edit_splice_disabled` (`EXISTING_EDIT_SPLICE_DISABLED`), whatever the edit, so even an approval entry for this
spec hash could not land a splice. The gates stay reachable only through `analyzeSuppliedEdit` (negative proofs and
census site eligibility, never an entry point).

**Hook: pending DERIVE_FROM_BEHAVIOR v1.** The reusable derive-from-examples engine is being built separately
(M99, branch `m99/derive-from-behavior`); this branch does not build a second one. `EXISTING_EDIT_DERIVER` is `null`
and `deriveExistingEditDetail` refuses with `edit_derive_pending`. When DERIVE_FROM_BEHAVIOR v1 is merged and reviewed:
set the deriver to an adapter around it, give `EXISTING_EDIT` a behavior-only trigger (target + behavior + G2 bullets,
code in the behavior text refused), and run the ONE derived (OLD, NEW) through `gateSuppliedEdit` unchanged (capability
delta, hermetic walk, `edit_unawaited`, Job B); zero or several fits refuse. That is a new spec hash and a new review.

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
- the same paths without member access: a reflection name as a destructuring key or object-literal key
  (`const { constructor: C } = f`, `const { constructor } = o`, `{ __proto__: o }`), or any non-literal computed
  property name (`const { [k]: C } = o`, `{ [k]: v }`)

Tokens are counted, not just checked for presence, so an edit can't add a second `?? fetch` beside one the base had.

The same counted delta covers un-awaited promises (G2 pass), giving `edit_unawaited:*`. An edit may not add:

- a bare statement calling a collaborator (a method on a parameter or `this`, or a parameter itself) without `await`
- `void <call>`
- a `.then` / `.catch` / `.finally` chain
- `new Promise(...)`
- a non-async callback that calls a collaborator, unless it feeds an awaited `Promise.all` / `Promise.allSettled`

Timers are capability tokens (above), and static or module mutable state reached by the tested code is refused by
the hermetic walk (`edit_global_write` / `edit_hidden_state`).

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

Grading order and confinement in `test-candidates.ts` (Auditor #489, hole 1):

- `existingEditStatic` (shape, capability delta, hermetic walk, load closure) runs on the applied tree before
  ANY candidate code executes. A refused edit is never run, and every pass stays false.
- The original-suite step (pass 1) imports the edited module, so for this kind it runs each test file in its own
  process under `--permission`. Reads are limited to the tree's `src/`, the package.json chain, node_modules and a
  scratch dir. Writes go only to the scratch dir, which is also TMPDIR/HOME. There is no child_process, addon or
  wasi access, and workers are allowed only for tsx's loader.
- In "related" mode, the related tests are judged by a confined run on the base. If any related test cannot pass
  confined even on the base, the candidate's original suite FAILS (fail closed), because it can't be checked
  without running the edit unconfined. In "full" mode, every base test must pass confined.
- Node 22's permission model does not restrict the network. The static gate (no new `fetch`/`process`/... token)
  and the hermetic walk are what stop network I/O.

## Allowlist (Auditor #489, review of 7508d20)

A banned-word list was walked around with no banned word and no computed key: X1 went
`Object.getOwnPropertyDescriptors(Object)` -> Object.prototype -> the `__proto__` getter's `.get.call(() => 0)` ->
Function.prototype -> Function, and X2 polluted Object.prototype the same way. So, after the capability delta and the
`edit_unawaited` check, every reference the edited target unit makes MORE often than the base unit did must be
allowlisted (`allowTokens`, Job A and Job B alike). Otherwise the result is `edit_not_allowlisted:<token>`.

What an edit may reference:
- the target's own parameters and locals, `this`, and fresh literals;
- member reads and method calls on those, except the banned member names below;
- `Math.min/max/floor/ceil/round/abs/trunc/sign`, `Number.isInteger/isFinite/isNaN/isSafeInteger/MAX_SAFE_INTEGER/MIN_SAFE_INTEGER`,
  `Array.isArray`, `Object.keys/values/entries` (own enumerable data only), `Promise.all/allSettled`;
- calls to `String`, `Number`, `Boolean`, `parseInt` and `parseFloat`; `new` of `Error`, `TypeError`, `RangeError`, `Map` and `Set`;
- `undefined`, `NaN` and `Infinity`.

Every entry is a pure, total function or constant over primitive or plain values, with no I/O, clock, randomness,
prototype, descriptor or function-constructor access. The justification for each entry is next to the constants in
`learned-edit-existing.ts`.

Tokens (each one is refused by a test, and each test was verified by removing the guard):

| token | refuses |
|---|---|
| `member:<m>` | any receiver: `call`, `apply`, `bind`, `getOwnPropertyDescriptor(s)`, `getOwnPropertyNames/Symbols`, `get/setPrototypeOf`, `defineProperty/ies`, `captureStackTrace`, `prepareStackTrace`, `stackTraceLimit` and the reflection names |
| `accessor:get\|set` | `.get` or `.set` read without being called directly (descriptor accessors) |
| `gm:<G>.<m>` | a member of a known global that isn't listed (`Object.assign`, `Object.fromEntries`, `Math.random`, ...) |
| `ref:<name>` | any other non-local identifier (`Date`, `RegExp`, `Symbol`, `JSON`, ...) |
| `size` | `repeat`/`padStart`/`padEnd` without a literal of at most 256; `Array(n)`/`new Array(n)`; `push`/`unshift`/`concat` of the receiver into itself; self-doubling assignment |
| `regex` | any regex literal (`RegExp` falls under `ref:RegExp`) |
| `reflstr:<s>` | a reflection name as a string literal |
| `call-local` | calling a local that isn't a parameter |
| `write-nonfresh` | a property write, delete or `++`/`--` whose owner isn't a fresh `const` literal local |
| `shadow` | a local named like an allowlisted or capability global |

Emitted tests come from the fixed bullet grammar, so fakes and data are literals. A `__proto__` key, a reflection key
or a quoted reflection key in a fake or in data is `edit_test_grammar`.

## Known residual risk

A computed read `x[k]` is allowed when the receiver is an identifier or `this`, and the key may come from the test.
The mitigations:

- Test strings equal to reflection names are refused.
- Literal keys are checked against the reflection list.
- Computed calls are refused.
- Any new cast, and any new dynamic computed key that isn't `param[param]`, is refused by the capability delta.

Member names on parameters and locals are an open domain (`client.head`, `deps.load`), so they are checked against a
denylist (`EDIT_BANNED_MEMBERS` plus the reflection names), not an allowlist. Every GLOBAL reference is allowlisted.

## Evidence

Bar: 10 per skill. The full list is in `peaceai/rules/proposals/m98-existing-function-edit-evidence.json`, with the
fixtures in `peaceai/test/fixtures/m98-ee/`.

- **G1:** 15 upstream commits from 15 permissive repos. `editStatement` on the parent text reproduces the child's
  code tokens exactly.
- **G2:** 15 upstream tests from 15 permissive repos that drive a method or function with injected object-literal
  fakes. The hermetic walk accepts the same call shape on the pinned closure.
