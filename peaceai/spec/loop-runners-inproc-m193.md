# M193 (batch 26): in-test result rewriting on vitest, jest and mocha

## Question

Batch 25 (M192) left one residual open: on vitest 4.1.10 a really failing test can rewrite its own result to a pass
(`ctx.onTestFailed` setting `ctx.task.result.state = "pass"`) and the m173 shim credits it. jest and mocha were not
probed. Auditor (#687 review) added that no test-file code is needed: a plain source function that a failing test
calls can push a callback onto `globalThis.__vitest_worker__.current.onFailed`, and real vitest credits it. This
batch probes all three supported runners through the real shim, and turns every attack into a killed case.

## Probe results (real runners through the real shim, before this batch)

| runner | credited (a false pass) | refused already | honest neighbours (credited, must stay) |
|---|---|---|---|
| vitest 4.1.10 | onTestFailed sets pass (errors [] or kept); an afterEach rewrites `ctx.task.result`; a failure turned into a skip beside a pass; `expect.extend` neuters `toBe`; SOURCE code reaching `__vitest_worker__.current`; SOURCE code importing `onTestFailed` | `process.exitCode = 0`; a beforeAll setting `mode = "skip"` (94); `expect.soft` | a retry that passes; `test.fails` |
| jest 29.7.0 | an afterEach clearing the circus test's `errors` (state found by symbol description); `expect.extend` neutering; SOURCE code swallowing `errors.push` | `process.exitCode = 0` | `jest.retryTimes`; `test.failing` |
| mocha 10.8.2 | a hook replacing `currentTest.fn`; an instance `run` on the test; a before hook removing the failing test; SOURCE code registering such a hook | `currentTest.state` rewrites; exitCode; an assertion after `done`; a test swapping its own fn | `this.retries` |

## Decision per runner

### mocha: made sound against this class (PeaceAI counts the run)

PeaceAI's own reporter counts mocha's run, in the guard preloaded before mocha and any repo code
(`MOCHA_GUARD_SOURCE`). New tagged guards, each a single line with a mutant:

- `m193-guard:mocha-pin-test`, `mocha-pin-hook`: every test (Suite#addTest) and hook (Suite#_createHook) is pinned to
  the function it was made with, before any of it runs. `mocha-pin-once`: a second addTest cannot re-pin a swapped fn.
  `mocha-pin-retry`: a retry's clone gets the original's pinned function.
- `m193-guard:mocha-fn-pin`: Runnable#run fails a runnable whose fn is not its pinned one. `mocha-mark-ran` marks the
  runnables that ran through this wrapper.
- `m193-guard:mocha-ran-here` / `mocha-hook-ran-here`: a pass for a test (a hook end) that did not run through the
  wrapper (an instance `run`) is a failure.
- The run's plan is taken at `start` (after .only, before any hook): `mocha-planned-test` (nothing unplanned or
  duplicated ends), `mocha-all-ran` (every planned test ends), `mocha-hooks-ran` (each planned hook ends exactly as
  often as mocha runs it: an all-hook once per suite with tests, an each-hook once per test attempt below it). A
  break adds a failure, so `tests != passes + failures` and the shim refuses the run (SUITE_LOAD). These checks
  apply only to a run with no failure, so a real failure keeps its plain exit 1.
- Every method the reporter uses later is captured at preload (WeakMap / WeakSet / Map methods, the constructors,
  Reflect.apply), and the reporter uses no array iterator, because it is built after spec files and source load.

Soundness note (mocha). Claim: no code that runs after the guard loads (spec files, the code under test, hooks)
can make a planned failing test count as passed through the channels above: its function (pinned), its run method
(ran-here), its place in the suite (plan), the hooks around it (plan), the emit and reporter (M173 pins), node:assert
(M173 freeze). This is a closure over the known channels, shown by the attack cases, not a proof over all of
JavaScript. Residuals: a spec file controls its own tests at load time (a Proxy over `suite.tests`, getters on a
suite, `Function.prototype.call` patched before the run; terminal: test files are not candidate-editable, TEAM_TEST_EDIT);
a third-party assertion library the spec file uses is not frozen (only node:assert is); `/proc/self/mem`, the
inspector, no ptrace hardening (M173).

### vitest and jest: terminal at the runner (M192 class), killed by the edit gate

The verdict is decided in the process that runs the code under test (vitest's worker, jest's in-band circus) and
reaches the reporter over a channel that process owns (birpc / in-process state). The rewrite happens in the same
object the runner reports, before it is sent, so no reporter-side check can tell it from a real result. A
pass-with-errors check was considered and refused: a passing retry legitimately keeps the earlier errors, and an
attacker sets `errors = []`, so it would refuse honest runs while catching nothing; that would be unearned credit.
Hiding `__vitest_worker__` from source code would not close it either: vitest exports `onTestFailed`, which source
code can import. Assertion neutering (`expect.extend`) is the same class on every runner: what an assertion means is
defined in that process.

So the kill is where the code comes from, the M175 edit gate (`editScopeProblem`, before anything runs):

- test-file placement: refused (`test-file`); a team test edit is `TEAM_TEST_EDIT` and stays terminal. Whoever
  edits a test file decides its verdict, so a test-file edit can never be soundly credited.
- SOURCE placement (Auditor's #687 case): refused, each for its own reason: `dangerous:globalThis` (worker reach,
  `expect.extend`, a mocha hook from source), `dangerous:constructor` (the Function-constructor route),
  `dangerous:import` (a dynamic import of vitest), `dangerous:Reflect`, `top-level-count` (an added import of
  `onTestFailed`), `global-write` (jest's circus state), and `new-word:<w>` when the file already holds the global in
  a const (words inside strings count, so splitting the name only makes other new words). jest's fixture is plain
  .js and is refused as `config` (outside the admitted class), as in M175.
- Each source placement is first shown as a real HAZARD: credited on the real runner through the real shim.

Residual (honest): this kill is the M175 syntactic bound, not a proof of unreachability. A source file that already
holds every word an attack needs (the worker's name, `onFailed`, `result`, `state`, ...) and a dangerous-word-free
route to the global would not be stopped by vocabulary alone. Widening the edit scope beyond the M175 gate therefore
needs a reach argument for the wider class, not a runner fix; this batch does not widen it.
Batch 35 (M199, `loop-runners-inproc-m199.md`): probed whether the residual can be closed (it cannot on vitest
4.x / jest 29.x: the assertion and the result live in the worker); any edit class wider than the bound is now
refused by name, `INPROC_VERDICT_TERMINAL` on vitest / jest and `INPROC_VERDICT_UNPROBED` elsewhere.
Batch 36 (M200, `loop-runners-inproc-m200.md`): node:test probed; not closable (its child forges the parent's
channel; in-process, the M173 report channel is reachable), so `INPROC_VERDICT_TERMINAL` on node:test too.
Batch 37 (M201, `loop-runners-inproc-m201.md`): mocha probed under this route; the m193 guards hold against
mocha-internal rewrites, but code under test reaches the report channel (fs binding, inspector, a worker, a child)
and mocha's Runnable through an Object.prototype setter, so mocha is `INPROC_VERDICT_TERMINAL` under a wider scope.

## Tests (`peaceai/test/m193-inproc-forge.test.ts`)

- mocha: 17 attacks refused on the real runner (including the source placement), 6 honest runs credited (nested
  hooks of every kind and an empty suite, a retry on its third try under each-hooks at two levels, .only, async,
  done), a real failure still exits 1. Mutation: deleting each of the 11 m193 tags credits its attack or refuses an
  honest run.
- vitest / jest: the residual attacks pinned as credited on the raw shim (if one stops being credited, update this
  spec), the refused ones, the honest neighbours (retry, test.fails, retryTimes, test.failing), and three SOURCE
  hazards (worker reach, an imported onTestFailed, jest's circus errors) credited on the real runners.
- gate: every test-file and source placement refused with its reason; the honest fixes (a leap-year rule, a
  temperature factor) and a neighbour using only the file's own words admitted.
- Shapes: leap years, roman numerals, a temperature conversion; none from PeaceSTOCKS, none from a dev task or a
  reference diff. No new fixture (reuses m172-real-mocha10, m173-forge-vitest4, m173-forge-jest29).

## Batch 33: refuse unsupported mocha majors in the detect path

The M193 mocha guards were probed on mocha 10.8.2 only (see the probe table above; 11 was not probed). Before this
batch, an unsupported major could surface as `PeaceAI loop: mocha internals not found` when the API no longer matched
what the guard requires. The detect path now refuses those majors with an explicit code:

- `MOCHA_SUPPORTED_MAJORS = [10]` (only majors actually proven in the probe table).
- `detectRunner` (mocha branch): reads the installed `node_modules/mocha/package.json` version when present, else the
  declared `mocha` dependency when its major is clear (`^10.8.2`, `10.2.0`, `~10.0.0`). A clear major outside the
  supported list is `TEST_RUNNER_UNSUPPORTED` (`m193-guard:mocha-major`). Unsure ranges (`*`, `>=9 <12`) are not
  refused here.
- `MOCHA_GUARD_SOURCE` (runtime): after loading mocha's `lib/`, reads `../package.json` and throws
  `PeaceAI loop: mocha major N is not supported (M193 guards cover 10.x only)` when the installed major is not 10,
  instead of relying on the internals check.

Soundness note: this is a fail-closed version gate over the probed major, not a proof that every 10.x build is safe.
A new major needs its own probe table row and an update to `MOCHA_SUPPORTED_MAJORS` before it is admitted. Mutation:
deleting `m193-guard:mocha-major` admits a declared or installed mocha 11 near-miss.

