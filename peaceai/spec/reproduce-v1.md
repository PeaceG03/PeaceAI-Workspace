# REPRODUCE-REPORTED-FAILURE v1 (M196, Batch 30)

Status: EXPERIMENTAL, PLAN-ONLY, NOT FOR CREDIT. Code: `peaceai/lib/reproduce.ts`; CLI: `peaceai/bin/reproduce-v1.ts`;
test: `peaceai/test/m196-reproduce.test.ts` (cases `m196-cases.ts`, fixtures `m196-fixtures.ts`).

## What it does

Input: a checkout and one plan-only-v5 diagnosis site (`plan5.ts` `diagnose`: an error code, the file and line, and
the shape the code leaves its function by). Output: either one CANDIDATE regression test, in the repo's own test runner,
that was observed to fail on the current code because the reported code was produced; or a refusal code.

1. Static plan (`planRepro`, no process is started):
   - the code must be CONSTANT_CASE (`REPRO_NO_DIAGNOSIS`) and the site a source file, not a test, helper under a test
     dir, or generated file (`REPRO_TEST_TARGET`);
   - the region: for a report via (`catch-*`), the try statement or promise chain at the site whose handler names the
     code; for a thrown code, the innermost throw/call/new at the line and the try that catches it (`caughtBy`). A
     throw no try catches is a data condition, not a dependency failure: `REPRO_NO_TRIGGER`;
   - the entry: the function directly enclosing the region must be a top-level exported function (ESM `export`, an
     exported const arrow, or CommonJS `module.exports` / `exports.x`); a report inside a callback or a private
     function is `REPRO_NO_ENTRY`;
   - the trigger: the first call, in the guarded part, of a parameter of the entry (`p(...)`, `p.m(...)`, or a name
     destructured from a parameter). Skipped: calls inside nested functions, inside an inner try, calls handled on the
     spot (`.catch(...)`, `.then(a, b)`), and data methods of a parameter (`map`, `filter`, `join`, `trim`, ...).
     None left: `REPRO_NO_TRIGGER`;
   - the observation: thrown (the call rejects or throws), returned (the result contains the code), logged (through
     console / process.stdout / process.stderr, or a logger passed in as a parameter: a logger imported from another
     module cannot be tapped without a module mock, `REPRO_NO_OBSERVE`), or pushed into a list that is a parameter
     or a local returned by the function (a module-level list: `REPRO_NO_OBSERVE`);
   - the existing test: a behaviour test of the same module (related tests first) whose import or destructured require
     binds the entry FROM the site's file, and calls it directly inside a plain `test` / `it` callback (not a hook; the
     call's statement in the callback body or in the try block of a try / finally, not under a catch, an if or a
     loop), with at least as many arguments as the trigger and the logger need and no spread. None: `REPRO_NO_EXISTING_TEST`;
   - the runner: `loopdeps.detectRunner` on the package of the existing test, as the loop picks it (`REPRO_RUNNER`).
2. The candidate test is written beside the existing test (`x.peaceai-repro.test.ts`), from that test's own file: its
   imports and top-level setup, the enclosing describe chain with its setup statements, and the statements of the
   test that precede the call (inside a try / finally: kept with its finally, the test's own cleanup). The call's argument list is captured into `__peaceaiArgs`; one argument is wrapped so
   the trigger throws (or rejects, when the call is awaited or chained); the entry is then called with the same
   arguments. Three variants:
   - `repro`: dependency failing, asserts the code is NOT produced;
   - `probe`: dependency failing, asserts the code IS produced;
   - `control`: no dependency failing, asserts the code is NOT produced.
3. Validation (`validateRepro`): the tracked files are copied into a private work dir, committed, dependencies
   installed by `loopdeps.installDeps` as the stage-2 candidate uid (`PEACEAI_STAGE2_CAND`; none: `REPRO_ISOLATION`
   `CAND_UID_REQUIRED`), the loop's runner wrapper and shim installed, and `loop.isolationProblem` checked. Each variant
   is then run alone by `selfpropose.guardedRun` (candidate uid, no network, deadline, leftover processes and tampered
   files checked) and removed. The judge (`judge`):

   | repro | probe | control | result |
   |---|---|---|---|
   | any run exited 97/98 (isolation) | | | `REPRO_ISOLATION` |
   | passed (exit 0, 1 test passed, clean) | | | `REPRO_NOT_FAILING` |
   | failed but not exactly 1 failing, 0 passing, exit 1 | | | `REPRO_WRONG_REASON` |
   | failed | did not pass | | `REPRO_WRONG_REASON` |
   | failed | passed | did not pass | `REPRO_VACUOUS` |
   | failed | passed | passed | `REPRO_OK` |

   "Clean" means no leftover process and no tampered file; the shim's made-up results (exit 93-95) are neither a
   pass nor a fail.

The CLI (`reproduce-v1.ts <checkout> --request <text>|--request-file <f> [--code C] [--site path:line] [--out dir]`)
runs the diagnosis, plans and validates one site, prints one line, and writes `result.json` (`forCredit: false`) and,
only on `REPRO_OK`, the kept test to the output dir. It never writes into the checkout.

## Soundness

What `REPRO_OK` proves, and only this: in the candidate sandbox, with the one injected dependency failing, the
entry produced the reported code (probe passed, so the module loaded, the setup ran, the failure reached the site and
was observed), the same test asserting the opposite failed exactly once (repro), and without the injection the code
was not produced (control: so the test is not vacuous, i.e. a correct fix that stops reporting the code under that
failure makes the repro test pass). The M196 sandbox test applies such a fix to a fixture and checks the kept test
then passes.

What it does not prove:

- That the injected failure is the one the user saw. It is one parameter dependency failing with a plain Error; the
  real failure may differ (a different dependency, a value rather than an exception, an imported module).
- That a fix is right. A "fix" that hides the code (renames it, swallows the error) also makes the repro pass. The
  test pins one symptom, not the behaviour around it.
- That the runs could not be forged. The code under test and its test setup run inside the runner; repo code that
  writes test-runner output or exits on its own could make a variant look passed or failed. The sandbox limits what it
  can reach (candidate uid, no network, a private copy), not what it prints. The probe/control pair makes an
  accidental forge unlikely, not impossible.
- Anything for code it refuses. Refusals are by design conservative: no module mocks, the trigger must be a
  parameter of the exported entry, the entry must already be called directly from a plain test.

## Not for credit

The generated test is never a grading test, never written into a checkout the loop grades, and nothing in the loop,
its grading, m119's credit sources or `selfpropose.ts` imports `reproduce.ts` (M196 checks this). Using generated
tests for credit of any kind needs a separate reviewed design: a self-written test can be vacuous, or pin the wrong
behaviour, in ways three runs do not rule out.

## Test notes (honest)

- The node:test and vitest shapes install dependencies through the real `installDeps` as the candidate uid (vitest
  from the pinned `fixtures/m173-forge-vitest4` lockfile). The pnpm + jest workspace fixture has no pnpm lockfile of
  its own (a generated one would not pin real transitive versions), so its test passes `provideDeps`: jest 29.7.0 from
  `fixtures/m173-forge-jest29` installed with `npm ci` and linked into the copy. The runner pick, wrapper, shim,
  isolation check and runs are the same as in the other shapes.
- The sandbox runs need a candidate uid (`M196_CAND`, else `M146_CAND`) and are skipped without one; the vitest and
  jest runs are skipped when offline outside CI.
- Mutation: each `repro-guard:` line is removed or loosened in turn, and a case written for that guard must fail.

## Batch 31: a call inside one helper callback

v1 took an existing test only when the entry was called directly in a plain `test(..)` / `it(..)` callback. Many
tests wrap the work in a helper of their own (`await withTmp(async (dir) => { .. entry(..) .. })`). v1 now also takes
a call that sits inside ONE callback passed to such a helper, when all of these hold (tagged in reproduce.ts):

- `repro-guard:existing-helper-local`: the helper is a plain identifier the test file declares at top level (function
  declaration, `const` arrow / function expression) or imports / `require`-destructures from a RELATIVE path. A
  helper from a package, a global, a member call (`t.step`), `test.each(..)(..)` or a hook is not one.
- `repro-guard:existing-helper-one-level`: the helper call itself is directly in a plain test callback (inside the
  same describe-only chain as before). A helper inside another helper's callback, or one called from a describe
  body, is refused (`nested-callback`).
- `repro-guard:existing-helper-async`: the callback is `async` (so the helper awaits what it runs). A sync callback is
  refused (`sync-callback`).

The candidate test keeps the statements before the helper call, then `await helper(<its other arguments as written>,
async (<the callback's own parameters>) => { <the callback's statements before the call> <the same injected
dependency, observe and check as before> })`, with try / finally levels kept on either side as before. The
three-variant judge, the candidate-uid sandbox and every earlier refusal are unchanged.

REPRO_NO_EXISTING_TEST now carries the first reason found, from a fixed vocabulary: `not-in-test` (a hook, a
test.each row, module level), `args`, `path` (a try / catch or other non-plain block), `unknown-helper`,
`nested-callback`, `sync-callback`.

A site plan-only-v5 marks `shape: "toplevel-catch"` (a module-level `main().catch(..)`) is refused with
REPRO_NO_ENTRY, detail `toplevel-catch` (`repro-guard:site-not-toplevel`): that function is a process entry with no
parameter dependency v1 could inject.

### Soundness note (Batch 31)

- The helper is code of the same repository, so its behaviour is what the existing test already relies on; the
  candidate calls it exactly as the test does (same arguments, awaited). A helper whose code is not in the repo
  (package, global) might not run the callback, run it more than once, or swallow its throw: refused.
- One level only: with the helper call directly in the test body, the only code between the test and the injected
  call is the helper itself. Deeper nesting would multiply those unknowns: refused with a precise reason.
- Async only: a sync callback would turn the injected rejection into an unawaited promise the helper never sees.
- What if the helper does not call the callback, or swallows its throw? Then the repro variant cannot fail for the
  code: probe fails (it asserts the code IS produced) and the judge returns REPRO_WRONG_REASON or REPRO_NOT_FAILING,
  so nothing is kept. No separate "the callback ran" marker is added because the probe already proves it ran and
  observed the code; a marker would be unreachable by a mutation test (the judge masks it).
- The helper's own cleanup (e.g. its try / finally) runs as in the existing test, and the sandbox's leftover check
  still applies to all three variants.
- Generated tests stay a CANDIDATE: never a grading test, never for credit; credit for them needs the separate
  reviewed design named above.

### Tests (Batch 31)

LEDGER_HELPERS (node:test; a local helper and the five near misses), SHELF `test/vault.test.ts` (vitest, helper
imported from ./helpers), AGENT `packages/agent/test/fetch.test.js` (jest CJS, helper required from ./support). Each
new condition has admit cases on two or three shapes and refused near misses that also check the reason; each new
guard has a removal mutant caught by a case of its own condition. The sandbox runs REPRO_OK on all three helper
admits as the candidate uid.

## Refusal codes

`REPRO_NO_DIAGNOSIS`, `REPRO_TEST_TARGET`, `REPRO_NO_ENTRY`, `REPRO_NO_TRIGGER`, `REPRO_NO_OBSERVE`,
`REPRO_NO_EXISTING_TEST`, `REPRO_RUNNER`, `REPRO_ISOLATION`, `REPRO_DEPS`, `REPRO_NOT_FAILING`, `REPRO_WRONG_REASON`,
`REPRO_VACUOUS`.
