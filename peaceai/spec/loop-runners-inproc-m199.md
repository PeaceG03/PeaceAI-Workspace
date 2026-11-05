# M199 (batch 35): the vitest / jest in-process residual is terminal, refused by name under a wider edit scope

## What was open

M193 (`loop-runners-inproc-m193.md`) left one accepted residual: on vitest and jest the verdict is decided in the
process that runs the code under test, so code that reaches the runner's state or the assertion library can turn
a real failure into a pass, and the shim credits it. M193 killed every probed attack with the M175 edit gate and
said so honestly: that kill is a syntactic bound, not a proof of unreachability, and widening the edit scope would
need a reach argument the batch did not have. M199 asks whether the residual can be closed for a runner; where it
cannot, it is made explicitly terminal under any wider edit scope with its own refusal code. The M175 scope is not
widened.

## Probes (real vitest 4.1.10, real jest 29.7.0, the real m173 shim; every attack placed in a SOURCE function an honest test calls)

| runner | attack | kind | before (raw shim) | after |
|---|---|---|---|---|
| vitest | `__vitest_worker__.current.onFailed` rewrites the result | runner state | CREDITED | killed (EDIT_SCOPE today; INPROC_VERDICT_TERMINAL wider) |
| vitest | imported `onTestFailed` rewrites the result | runner state | CREDITED | killed (same) |
| vitest | task result replaced by a getter | state patch | CREDITED | killed (same) |
| vitest | worker rpc `onTaskUpdate` wrapped to report pass | reporter channel | refused (exit 1) | killed (same) |
| vitest | `Object.is` patched (toBe always holds) | assertion (primordial) | CREDITED | killed (same) |
| vitest | `expect.extend` from source neuters toBe | assertion (expect) | CREDITED | killed (same) |
| vitest | fake counts on stdout / stderr | stdout / stderr | refused (exit 1) | killed (same) |
| vitest | forged report line on fd 3 | report fd | refused (no report, timeout) | killed (same) |
| vitest | `process.exit(0)` mid-test | exit | refused (exit 1) | killed (same) |
| vitest | `exitCode = 0` then `reallyExit(0)` | exit | refused (93 EXIT_ONLY) | killed (same) |
| jest | circus test `errors.push` swallowed | runner state | CREDITED | killed (same) |
| jest | circus test `errors` replaced by a getter | state patch | CREDITED | killed (same) |
| jest | `Object.is` patched | assertion (primordial) | CREDITED | killed (same) |
| jest | global `expect.extend` neuters toBe | assertion (expect) | CREDITED | killed (same) |
| jest | fake stdout / stderr counts and a forged fd 3 line | stdout / report fd | refused (95) | killed (same) |
| jest | `process.exit(0)` mid-test | exit | refused (95) | killed (same) |
| jest | `exitCode = 0` then `reallyExit(0)` | exit | refused (95) | killed (same) |

Out-of-process routes considered for a close, each probed on the real runner:

- vitest `--reporter=junit` / `--reporter=json` with `--outputFile` OUTSIDE the tree, and `--pool=forks --isolate`:
  the worker-onFailed and `Object.is` attacks are still reported as passes (the report is built from the state the
  worker sends). The honest control reads as a failure, so the route works; it just carries the forged state.
- jest `--json --outputFile` outside the tree, in band and with `-w 2` (each file in its own worker): the circus
  and `Object.is` attacks are still passes.
- Freezing the intrinsics (`Object.is`, `Object`, `Error`, ...) in a setup file before user code: breaks honest runs
  (jest: `Cannot assign to read only property 'stackTraceLimit'`; vitest: the suite fails with no tests run).
- Contrast: on mocha with node:assert the same `Object.is` patch is refused, because node:assert uses node's own
  primordials; that is why M193 could make mocha sound and why the result does not carry over.

## Decision per runner

- vitest 4.x: NOT closable; TERMINAL. The assertion (`expect`, `Object.is` via toBe) and the result object both live
  in the worker that runs the code under test. Any reporter, file report, pool or isolation mode reads what that
  worker decided. The test body really completes (the assertion was made to hold), so a per-test sentinel or a
  completion marker cannot tell it from an honest pass.
- jest 29.x: NOT closable; TERMINAL, same argument (circus state and `expect` in the test's own realm, in band or
  in a worker).
- mocha 10.x: the M193 guards are unchanged and still hold under today's scope. Under a WIDER scope it is
  `INPROC_VERDICT_UNPROBED` (fail closed): M193 froze node:assert only, and a third-party assertion library a spec
  file uses is not frozen.
- node:test: probed in M200 (`loop-runners-inproc-m200.md`): NOT closable, `INPROC_VERDICT_TERMINAL` under a wider
  scope (`m200-guard:node-test`).
- mocha (superseded, M201, `loop-runners-inproc-m201.md`): probed under the M193 route; report-channel attacks and an
  in-heap Object.prototype attack are credited, so mocha is `INPROC_VERDICT_TERMINAL` under a wider scope
  (`m201-guard:mocha`).
- anything else: `INPROC_VERDICT_UNPROBED` under a wider scope (not probed).

## Mechanism (`peaceai/lib/loop.ts`)

- `INPROC_BOUNDED_SCOPE` = `["export-keyword", "in-body"]`, frozen and pinned apart from `EDIT_SCOPE_POLICY`: the
  classes the M193 kill argument was made for.
- `inprocScopeProblem(runner, classes)`: null when every edit class is in the bound (`m199-guard:bounded`);
  otherwise `INPROC_VERDICT_TERMINAL` for vitest (`m199-guard:vitest`) and jest (`m199-guard:jest`),
  `INPROC_VERDICT_UNPROBED` for every other runner (`m199-guard:unprobed`).
- Wired right after the M175 scope gate (`m199-guard:loop-wide`): the classes of the candidate's source edits are
  judged against the detected runner before anything runs; a hit ends the loop with the code (attempts 0).
- Both codes are LOOP_CODES and v2-only (rows v4-valid, not v1 codes). The v4 default digest, selfpropose.ts and
  plandefault.ts are unchanged.

## Soundness note

Today the gate is inert: `EDIT_SCOPE_POLICY.edit` sits inside `INPROC_BOUNDED_SCOPE`, so anything it would refuse is
already refused by M175 as `EDIT_SCOPE`, and every probed attack is outside the bound (M175 refuses each today). What
M199 adds is that the M193 residual can no longer be silently widened: a policy or class change that admits a wider
edit (a new file, multi-token, a dangerous word, config) on vitest or jest is refused by name,
`INPROC_VERDICT_TERMINAL`, rather than credited. The e2e mutant shows this: with the policy widened to `new-file`, a
wider proposal on vitest is refused before any run, and with `m199-guard:loop-wide` deleted the same proposal is
credited. This is a refusal, not a close: in-body edits on vitest / jest still rest on the M175 syntactic bound
(the M193 residual note stands). It is sound in the sense that the bound is now the explicit precondition of
credit on those runners, and widening it needs a new probe-backed batch, not a policy edit.

## Tests (`peaceai/test/m199-inproc-verdict.test.ts`)

- before: the 17 attacks above, each pinned to its probed result on the raw shim (credited ones are the residual).
- routes: out-of-tree junit/json reports, forks + isolate, jest json in band and `-w 2` still credit; freezing the
  intrinsics breaks honest runs; mocha refuses the `Object.is` patch.
- after: every attack is outside the bound, refused by M175 today, and `INPROC_VERDICT_TERMINAL` on its detected
  runner.
- honest: a leap-year fix and a temperature-factor fix credited on both vitest and jest; the bad versions fail; the
  in-body class is admitted on vitest, jest, mocha and node:test (jest's fixture is plain .js, which M175 classes
  as `config`; the gate evidence uses the .ts twins, as in M193).
- gate: one case per guard, each with a refused near miss; tags are single lines; deleting each tag in a mutant copy
  of loop.ts fails a case of its own guard; the unmutated copy passes.
- loop wiring (candidate uid): unmutated, the in-body fix passes and a new file is `EDIT_SCOPE`; widened, the wider
  proposal is `INPROC_VERDICT_TERMINAL` with attempts 0 and the in-body fix still passes; widened without
  `m199-guard:loop-wide`, the wider proposal is credited.
- Shapes: leap years, temperature conversion, roman numerals; none from PeaceSTOCKS, a dev task or a reference diff.
  No new fixture (reuses m172-real-mocha10, m173-forge-vitest4, m173-forge-jest29).

## Residuals (honest)

- vitest / jest under today's scope: the M193 note stands (a syntactic bound, not unreachability).
- mocha with a third-party assertion library: not probed, refused under a wider scope as UNPROBED. Superseded by
  M201 (`loop-runners-inproc-m201.md`): mocha is TERMINAL under a wider scope.
- node:test: superseded by M200 (`loop-runners-inproc-m200.md`): probed, terminal, refused under a wider scope as
  `INPROC_VERDICT_TERMINAL`. M200 also shows the M173 report channel itself is reachable from in-process code (fs
  binding, inspector), which bears on any future mocha widening.
- Unchanged from M173: `/proc/self/mem`, the inspector, no ptrace hardening.
